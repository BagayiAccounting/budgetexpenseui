import type { User } from "@auth0/nextjs-auth0/types";

const DEFAULT_BASE_URL = "http://localhost:8001";

function getUserServiceBaseUrl() {
  return process.env.USER_SERVICE_BASE_URL || DEFAULT_BASE_URL;
}

function getOptionalSurrealHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const ns = process.env.SURREAL_NS;
  const db = process.env.SURREAL_DB;
  if (ns) headers["Surreal-NS"] = ns;
  if (db) headers["Surreal-DB"] = db;
  return headers;
}

function summarizeJwt(token: string): string {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return "non_jwt";
    const payload = JSON.parse(Buffer.from(base64UrlToBase64(parts[1]), "base64").toString("utf8"));
    const aud = Array.isArray(payload.aud) ? payload.aud.join(",") : payload.aud;
    const scope = payload.scope;
    const exp = payload.exp;
    const iss = payload.iss;
    return `aud=${aud ?? ""} scope=${scope ?? ""} exp=${exp ?? ""} iss=${iss ?? ""}`.trim();
  } catch {
    return "unparseable_jwt";
  }
}

function base64UrlToBase64(value: string): string {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return padded.replace(/-/g, "+").replace(/_/g, "/");
}

type EnsureUserExistsResult =
  | { status: "exists"; user: unknown }
  | { status: "created"; user: unknown }
  | { status: "skipped"; reason: string };

export async function ensureUserExists(options: {
  accessToken: string | undefined;
  user: User;
}): Promise<EnsureUserExistsResult> {
  const { accessToken, user } = options;

  if (!accessToken) {
    return { status: "skipped", reason: "missing_access_token" };
  }

  if (!user?.sub) {
    return { status: "skipped", reason: "missing_user_sub" };
  }

  const baseUrl = getUserServiceBaseUrl();
  const url = `${baseUrl}/key/user`;
  const surrealHeaders = getOptionalSurrealHeaders();

  if (process.env.NODE_ENV !== "production") {
    console.log("[userService] checking user:", url);
    console.log("[userService] token:", summarizeJwt(accessToken));
    if (Object.keys(surrealHeaders).length) {
      console.log("[userService] surreal headers enabled");
    }
  }

  const getRes = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...surrealHeaders,
    },
    cache: "no-store",
  });

  if (process.env.NODE_ENV !== "production") {
    console.log("[userService] GET /key/user status:", getRes.status);
  }

  if (getRes.ok) {
    const data = await safeJson(getRes);

    // Some backends (e.g., SurrealDB-style responses) return 200 OK with an empty `result` array
    // when the record does not exist.
    if (!isEmptySurrealResult(data)) {
      return { status: "exists", user: data };
    }
    // Fall through to create when result is empty.
  }

  // Most APIs use 404 for "not found"; some return 200 with empty result (handled above).
  if (!getRes.ok && getRes.status !== 404) {
    const body = await safeText(getRes);
    return { status: "skipped", reason: `check_failed_${getRes.status}_${truncate(body)}` };
  }

  const createPayload = {
    email: user.email,
    name: user.name,
    nickname: (user as any).nickname ?? user.nickname,
    picture: user.picture,
    auth_sub: user.sub,
  };

  const createRes = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...surrealHeaders,
    },
    body: JSON.stringify(createPayload),
    cache: "no-store",
  });

  if (process.env.NODE_ENV !== "production") {
    console.log("[userService] POST /key/user status:", createRes.status);
  }

  if (!createRes.ok) {
    const body = await safeText(createRes);
    return { status: "skipped", reason: `create_failed_${createRes.status}_${truncate(body)}` };
  }

  const created = await safeJson(createRes);
  return { status: "created", user: created };
}

function isEmptySurrealResult(payload: unknown): boolean {
  if (!Array.isArray(payload) || payload.length === 0) return false;
  const first = payload[0] as any;
  if (!first || typeof first !== "object") return false;
  if (!Object.prototype.hasOwnProperty.call(first, "result")) return false;
  const result = first.result;
  return Array.isArray(result) && result.length === 0;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function truncate(value: string, max = 200): string {
  const v = (value || "").replace(/\s+/g, " ").trim();
  if (v.length <= max) return v;
  return `${v.slice(0, max)}…`;
}
