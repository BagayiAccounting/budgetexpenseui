import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { fetchAccountBalancesBatch } from "@/lib/settingsService";

export const dynamic = "force-dynamic";

// POST /api/settings/balances - Batch fetch TigerBeetle balances for multiple accounts
export async function POST(req: Request) {
  console.log("[api] POST /api/settings/balances");

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

  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const accountIds = body?.accountIds;

  if (!Array.isArray(accountIds)) {
    console.log("[api] invalid_payload - accountIds must be an array");
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  // Filter to only valid string IDs
  const validAccountIds = accountIds.filter((id): id is string => typeof id === "string" && id.length > 0);

  if (validAccountIds.length === 0) {
    return NextResponse.json({ balances: {} });
  }

  console.log("[api] fetching balances for", validAccountIds.length, "accounts");

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

  const result = await fetchAccountBalancesBatch({
    accessToken: token,
    accountIds: validAccountIds,
  });

  if (result.status !== "ok") {
    console.log("[api] fetchAccountBalancesBatch failed", result);
    return NextResponse.json({ error: result.reason }, { status: 500 });
  }

  return NextResponse.json({ balances: result.balances });
}