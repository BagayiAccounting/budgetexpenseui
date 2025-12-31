import type { User } from "@auth0/nextjs-auth0/types";
import { ensureUserExists, getBackendUserId } from "@/lib/userService";
import { fetchLogged } from "@/lib/http";

const DEFAULT_BASE_URL = "http://localhost:8001";

function getBudgetServiceBaseUrl() {
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

type CreateCategoriesResult =
  | { status: "created"; created: string[] }
  | { status: "skipped"; reason: string };

type ListCategoriesResult =
  | { status: "ok"; count: number; raw: unknown }
  | { status: "skipped"; reason: string };

export async function listCategories(options: {
  accessToken: string | undefined;
  user: User;
}): Promise<ListCategoriesResult> {
  const { accessToken, user } = options;

  if (!accessToken) return { status: "skipped", reason: "missing_access_token" };
  if (!user?.sub) return { status: "skipped", reason: "missing_user_sub" };

  const baseUrl = getBudgetServiceBaseUrl();
  const path = process.env.CATEGORY_LIST_PATH || "/key/category";
  const url = `${baseUrl}${path}`;
  const surrealHeaders = getOptionalSurrealHeaders();

  const res = await fetchLogged(
    url,
    {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...surrealHeaders,
    },
    cache: "no-store",
    },
    { name: "budgetService.GET /key/category" },
  );

  if (!res.ok) {
    const body = await safeText(res);
    return { status: "skipped", reason: `list_failed_${res.status}_${truncate(body)}` };
  }

  const raw = await safeJson(res);
  const count = countFromPayload(raw);
  if (count == null) {
    return { status: "skipped", reason: "unrecognized_list_response" };
  }

  return { status: "ok", count, raw };
}

export async function hasAnyCategories(options: {
  accessToken: string | undefined;
  user: User;
}): Promise<{ status: "ok"; hasAny: boolean } | { status: "skipped"; reason: string }> {
  const res = await listCategories(options);
  if (res.status !== "ok") return res;
  return { status: "ok", hasAny: res.count > 0 };
}

export async function createCategories(options: {
  accessToken: string | undefined;
  user: User;
  categories: string[];
}): Promise<CreateCategoriesResult> {
  const { accessToken, user, categories } = options;

  if (!accessToken) return { status: "skipped", reason: "missing_access_token" };
  if (!user?.sub) return { status: "skipped", reason: "missing_user_sub" };

  const normalized = Array.from(
    new Set(
      (categories || [])
        .map((c) => (c || "").trim())
        .filter(Boolean)
        .map((c) => c.slice(0, 60)),
    ),
  );

  if (normalized.length === 0) {
    return { status: "skipped", reason: "no_categories" };
  }

  const baseUrl = getBudgetServiceBaseUrl();
  const createPath = process.env.CATEGORY_CREATE_PATH || "/sql";
  const createUrl = `${baseUrl}${createPath}`;
  const surrealHeaders = getOptionalSurrealHeaders();

  // If we're creating via SurrealQL, we need the backend user's record id to set user_id.
  const createViaSql = createPath.endsWith("/sql") || createPath === "/sql";

  if (createViaSql) {
    // Ensure the backend user exists, then fetch its record id.
    const ensured = await ensureUserExists({ accessToken, user });
    if (ensured.status === "skipped") return { status: "skipped", reason: `user_sync_${ensured.reason}` };

    const backendUserRes = await getBackendUserId({ accessToken, user });
    if (backendUserRes.status !== "ok") {
      return { status: "skipped", reason: `missing_backend_user_id_${backendUserRes.reason}` };
    }

    const { table, id } = parseSurrealThingId(backendUserRes.id);
    if (!table || !id) {
      return { status: "skipped", reason: "invalid_backend_user_id" };
    }

    const created: string[] = [];
    for (const name of normalized) {
      const statement = buildCreateCategorySql({ name, userTable: table, userId: id });

      const res = await fetchLogged(
        createUrl,
        {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "text/plain",
          ...surrealHeaders,
        },
        body: statement,
        cache: "no-store",
        },
        { name: "budgetService.POST /sql (create category)" },
      );

      if (!res.ok) {
        const body = await safeText(res);
        return { status: "skipped", reason: `create_failed_${res.status}_${truncate(body)}` };
      }

      created.push(name);
    }

    return { status: "created", created };
  }

  // Fallback: REST-ish JSON create (previous behavior)
  const created: string[] = [];
  for (const name of normalized) {
    const res = await fetchLogged(
      createUrl,
      {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...surrealHeaders,
      },
      body: JSON.stringify({
        name,
        auth_sub: user.sub,
      }),
      cache: "no-store",
      },
      { name: "budgetService.POST /key/category" },
    );

    if (!res.ok) {
      const body = await safeText(res);
      return { status: "skipped", reason: `create_failed_${res.status}_${truncate(body)}` };
    }

    created.push(name);
  }

  return { status: "created", created };
}

function parseSurrealThingId(value: string): { table: string | null; id: string | null } {
  const v = (value || "").trim();
  const idx = v.indexOf(":");
  if (idx <= 0 || idx === v.length - 1) return { table: null, id: null };
  return { table: v.slice(0, idx), id: v.slice(idx + 1) };
}

function buildCreateCategorySql(options: {
  name: string;
  userTable: string;
  userId: string;
}): string {
  const { name, userTable, userId } = options;
  // Use JSON.stringify to safely quote/escape strings for SurrealQL.
  return `CREATE category CONTENT {\n  name: ${JSON.stringify(name)},\n  user_id: type::thing(${JSON.stringify(userTable)}, ${JSON.stringify(userId)})\n};`;
}

function countFromPayload(payload: unknown): number | null {
  // SurrealDB-style: [{ result: [...] }]
  if (Array.isArray(payload)) {
    if (payload.length === 0) return 0;
    const first = payload[0] as any;
    if (first && typeof first === "object" && Array.isArray(first.result)) {
      return first.result.length;
    }
    // Plain array of categories
    return payload.length;
  }

  // Common REST: { result: [...] }
  if (payload && typeof payload === "object") {
    const anyPayload = payload as any;
    if (Array.isArray(anyPayload.result)) return anyPayload.result.length;
    if (Array.isArray(anyPayload.categories)) return anyPayload.categories.length;
    if (Array.isArray(anyPayload.data)) return anyPayload.data.length;
  }

  return null;
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
