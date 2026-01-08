import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { fetchLogged } from "@/lib/http";

const DEFAULT_BASE_URL = "http://localhost:8001";

function getBaseUrl() {
  return process.env.BUDGET_SERVICE_BASE_URL || process.env.USER_SERVICE_BASE_URL || DEFAULT_BASE_URL;
}

function getOptionalSurrealHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const ns = process.env.SURREAL_NS;
  const db = process.env.SURREAL_DB;
  if (ns) headers["Surreal-NS"] = ns;
  if (db) headers["Surreal-DB"] = db;
  return headers;
}

function toSurrealThingLiteral(value: string): string | null {
  const v = (value || "").trim();
  const idx = v.indexOf(":");
  if (idx <= 0 || idx === v.length - 1) return null;
  const table = v.slice(0, idx);
  const id = v.slice(idx + 1);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) return null;
  if (!/^[A-Za-z0-9_]+$/.test(id)) return null;
  return `${table}:${id}`;
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
    const scope = process.env.AUTH0_SCOPE;
    const accessTokenOptions = {
      ...(audience ? { audience } : {}),
      ...(scope ? { scope } : {}),
    };

    const { token } = await auth0.getAccessToken(accessTokenOptions);
    if (!token) {
      return NextResponse.json({ error: "No access token", reason: "missing_token" }, { status: 401 });
    }

    const body = await req.json();
    const { fromAccountId, toAccountId, amount, type, status, description, label } = body;

    if (!fromAccountId || !toAccountId || !amount || !type) {
      return NextResponse.json({ error: "Missing required fields", reason: "missing_fields" }, { status: 400 });
    }

    if (amount <= 0) {
      return NextResponse.json({ error: "Amount must be positive", reason: "invalid_amount" }, { status: 400 });
    }

    const fromLiteral = toSurrealThingLiteral(fromAccountId);
    const toLiteral = toSurrealThingLiteral(toAccountId);

    if (!fromLiteral || !toLiteral) {
      return NextResponse.json({ error: "Invalid account ID", reason: "invalid_account_id" }, { status: 400 });
    }

    // Get user ID for created_by field
    const userQuery = "SELECT VALUE id FROM user WHERE auth_sub = $token.sub LIMIT 1;";
    const baseUrl = getBaseUrl();
    const surrealHeaders = getOptionalSurrealHeaders();

    const userRes = await fetchLogged(
      `${baseUrl}/sql`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain",
          ...surrealHeaders,
        },
        body: userQuery,
      },
      { name: "transferAPI.POST /sql (get user)" },
    );

    if (!userRes.ok) {
      return NextResponse.json({ error: "Failed to get user", reason: "user_fetch_failed" }, { status: 500 });
    }

    const userData = await userRes.json();
    const userId = userData?.[0]?.result?.[0];

    if (!userId) {
      return NextResponse.json({ error: "User not found", reason: "user_not_found" }, { status: 404 });
    }

    const userLiteral = toSurrealThingLiteral(userId);
    if (!userLiteral) {
      return NextResponse.json({ error: "Invalid user ID", reason: "invalid_user_id" }, { status: 500 });
    }

    // Build the transfer creation query
    const transferStatus = status || "draft";
    const query = `CREATE transfer CONTENT {
  from_account_id: ${fromLiteral},
  to_account_id: ${toLiteral},
  amount: ${amount},
  type: ${JSON.stringify(type)},
  status: ${JSON.stringify(transferStatus)},
  created_by: ${userLiteral}${description ? `,\n  description: ${JSON.stringify(description)}` : ""}${label ? `,\n  label: ${JSON.stringify(label)}` : ""}
};`;

    const res = await fetchLogged(
      `${baseUrl}/sql`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain",
          ...surrealHeaders,
        },
        body: query,
      },
      { name: "transferAPI.POST /sql (create transfer)" },
    );

    if (!res.ok) {
      const errorText = await res.text();
      return NextResponse.json(
        { error: "Failed to create transfer", reason: "create_failed", details: errorText },
        { status: res.status },
      );
    }

    const data = await res.json();
    const result = data?.[0]?.result?.[0];

    if (!result) {
      return NextResponse.json({ error: "No transfer created", reason: "empty_result" }, { status: 500 });
    }

    return NextResponse.json({ success: true, transfer: result });
  } catch (error) {
    console.error("Transfer creation error:", error);
    return NextResponse.json(
      { error: "Internal server error", reason: "server_error" },
      { status: 500 },
    );
  }
}
