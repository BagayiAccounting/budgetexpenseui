import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createAccount } from "@/lib/budgetingService";

const ACCOUNT_TYPES = ["asset", "expense", "liability", "revenue", "equity"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  console.log("[api] POST /api/budgeting/accounts");

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
