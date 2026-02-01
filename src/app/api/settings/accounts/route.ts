import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createAccount } from "@/lib/settingsService";
import { executeSurrealQL, getResultArray, thingIdToString } from "@/lib/surrealdb";

const ACCOUNT_TYPES = ["asset", "expense", "liability", "revenue", "equity"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

export const dynamic = "force-dynamic";

// GET /api/settings/accounts - List accounts (optionally with balances from TigerBeetle)
export async function GET(req: Request) {
  console.log("[api] GET /api/settings/accounts");

  const session = await auth0.getSession();
  if (!session?.user) {
    console.log("[api] unauthorized (no session)");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const withBalances = url.searchParams.get("withBalances") === "true";

  const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
  const scope = process.env.AUTH0_SCOPE;
  const accessTokenOptions = {
    ...(audience ? { audience } : {}),
    ...(scope ? { scope } : {}),
  };

  let token: string | undefined;
  try {
    const res = await auth0.getAccessToken(accessTokenOptions);
    token = res.token;
  } catch {
    console.log("[api] token_error");
    return NextResponse.json({ error: "token_error" }, { status: 500 });
  }

  // Query with or without TigerBeetle balance based on parameter
  const query = withBalances
    ? `SELECT *, category_id.name AS category_name, fn::tb_account(id) AS tb_account FROM account;`
    : `SELECT *, category_id.name AS category_name FROM account;`;

  const result = await executeSurrealQL({
    token,
    query,
    logName: `accountsRoute.GET ${withBalances ? "(with balances)" : "(without balances)"}`,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  type AccountRecord = {
    id: unknown;
    name?: unknown;
    category_id?: unknown;
    category_name?: string;
    tb_account?: {
      book_balance?: string;
      spendable_balance?: string;
      projected_balance?: string;
    };
    type?: string;
  };

  const accountsRaw = getResultArray<AccountRecord>(result.data[0]);

  const accounts = accountsRaw
    .map((a) => {
      const id = thingIdToString(a.id);
      const name = typeof a.name === "string" ? a.name : "(Unnamed)";
      const categoryName = typeof a.category_name === "string" ? a.category_name : "(Unknown)";
      const categoryId = thingIdToString(a.category_id) || "";
      const accountType = typeof a.type === "string" ? a.type : undefined;
      
      // Extract balance if available
      let balance: string | undefined;
      if (withBalances && a.tb_account && typeof a.tb_account === "object") {
        const tbAccount = a.tb_account;
        // Handle wrapped response from fn::tb_account
        const data = (tbAccount as Record<string, unknown>).data || tbAccount;
        balance = typeof (data as Record<string, unknown>).book_balance === "string" 
          ? (data as Record<string, unknown>).book_balance as string 
          : undefined;
      }

      if (!id) return null;
      return { id, name, categoryName, categoryId, type: accountType, balance };
    })
    .filter(Boolean);

  return NextResponse.json({ accounts });
}

export async function POST(req: Request) {
  console.log("[api] POST /api/settings/accounts");

  const session = await auth0.getSession();
  if (!session?.user) {
    console.log("[api] unauthorized (no session)");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    console.log("[api] invalid_json");
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const body = (payload && typeof payload === "object") ? (payload as Record<string, unknown>) : null;
  const categoryId = body?.categoryId;
  const name = body?.name;
  const type = body?.type;
  if (typeof categoryId !== "string" || typeof name !== "string" || typeof type !== "string") {
    console.log("[api] invalid_payload", { categoryIdType: typeof categoryId, nameType: typeof name, typeType: typeof type });
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  if (!ACCOUNT_TYPES.includes(type as AccountType)) {
    console.log("[api] invalid_type", { type });
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }

  console.log("[api] createAccount request", { categoryId, nameLength: name.length, type });

  const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
  const scope = process.env.AUTH0_SCOPE;
  const accessTokenOptions = {
    ...(audience ? { audience } : {}),
    ...(scope ? { scope } : {}),
  };

  let token: string | undefined;
  try {
    const res = await auth0.getAccessToken(accessTokenOptions);
    token = res.token;
  } catch {
    console.log("[api] token_error");
    return NextResponse.json({ error: "token_error" }, { status: 500 });
  }

  const result = await createAccount({ accessToken: token, categoryThingId: categoryId, name, type: type as AccountType });
  if (result.status !== "created") {
    console.log("[api] createAccount failed", result);
    const reason = (result as { reason?: unknown }).reason;
    const isClientError = typeof reason === "string" && (reason.startsWith("missing_") || reason.startsWith("invalid_"));
    return NextResponse.json(result, { status: isClientError ? 400 : 500 });
  }

  return NextResponse.json({ status: "created" });
}
