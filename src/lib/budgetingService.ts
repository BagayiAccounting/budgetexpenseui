import { fetchLogged } from "@/lib/http";

const DEFAULT_BASE_URL = "http://localhost:8001";

type SurrealQueryResult = { status?: string; time?: string; result?: unknown };

type CategoryRecord = {
  id: unknown;
  name?: unknown;
};

type AccountRecord = {
  id: unknown;
  name?: unknown;
  category_id?: unknown;
  tb_account?: unknown;
};

export type TbAccount = {
  book_balance: string;
  credits_pending: string;
  credits_posted: string;
  debits_pending: string;
  debits_posted: string;
  flags: string[];
  id: string;
  ledger: number;
  projected_balance: string;
  spendable_balance: string;
  user_data_128: string;
};

export type CategoryWithAccounts = {
  id: string;
  name: string;
  accounts: Array<{ id: string; name: string; tbAccount?: TbAccount }>;
};

function asTbAccount(value: unknown): TbAccount | undefined {
  if (!value || typeof value !== "object") return undefined;
  // We expect Surreal to always return this exact shape; keep runtime checks minimal.
  return value as TbAccount;
}

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

function thingIdToString(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  // Some Surreal clients return { tb: "table", id: "..." }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const tb = record["tb"];
    const id = record["id"];
    if (typeof tb === "string" && typeof id === "string") {
      return `${tb}:${id}`;
    }
    if (typeof id === "string") return id;
  }
  return undefined;
}

function parseSurrealSqlPayload(payload: unknown): SurrealQueryResult[] | null {
  if (!Array.isArray(payload)) return null;
  return payload as SurrealQueryResult[];
}

function getResultArray<T = unknown>(statement: SurrealQueryResult | undefined): T[] {
  const result = statement?.result;
  return Array.isArray(result) ? (result as T[]) : [];
}

export async function listCategoriesWithAccounts(options: {
  accessToken: string | undefined;
}): Promise<{ status: "ok"; categories: CategoryWithAccounts[] } | { status: "skipped"; reason: string }> {
  const { accessToken } = options;
  if (!accessToken) return { status: "skipped", reason: "missing_access_token" };

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/sql`;
  const surrealHeaders = getOptionalSurrealHeaders();

  // Minimal assumptions about schema:
  // - categories stored in table `category`
  // - accounts stored in table `account` with field `category_id` pointing to the category thing
  const query = "SELECT * FROM category; SELECT *, fn::tb_account(tb_account_id) AS tb_account FROM account;";

  const res = await fetchLogged(
    url,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "text/plain",
        ...surrealHeaders,
      },
      body: query,
      cache: "no-store",
    },
    { name: "budgetingService.POST /sql (list categories+accounts)" },
  );

  if (!res.ok) {
    const body = await safeText(res);
    return { status: "skipped", reason: `list_failed_${res.status}_${truncate(body)}` };
  }

  const payload = await safeJson(res);
  const statements = parseSurrealSqlPayload(payload);
  if (!statements) return { status: "skipped", reason: "unrecognized_sql_response" };

  const categoriesRaw = getResultArray<CategoryRecord>(statements[0]);
  const accountsRaw = getResultArray<AccountRecord>(statements[1]);

  const categories: CategoryWithAccounts[] = categoriesRaw
    .map((c) => {
      const id = thingIdToString(c.id);
      const name = typeof c.name === "string" ? c.name : "(Unnamed category)";
      if (!id) return null;
      return { id, name, accounts: [] as Array<{ id: string; name: string; tbAccount?: TbAccount }> };
    })
    .filter(Boolean) as CategoryWithAccounts[];

  const byCategoryId = new Map<string, CategoryWithAccounts>();
  for (const c of categories) byCategoryId.set(c.id, c);

  for (const a of accountsRaw) {
    const accountId = thingIdToString(a.id);
    const accountName = typeof a.name === "string" ? a.name : "(Unnamed account)";
    const categoryId = thingIdToString(a.category_id);
    if (!accountId || !categoryId) continue;
    const cat = byCategoryId.get(categoryId);
    if (!cat) continue;
    cat.accounts.push({ id: accountId, name: accountName, tbAccount: asTbAccount(a.tb_account) });
  }

  // Stable sort for nicer UI.
  categories.sort((a, b) => a.name.localeCompare(b.name));
  for (const c of categories) c.accounts.sort((a, b) => a.name.localeCompare(b.name));

  return { status: "ok", categories };
}

export async function createAccount(options: {
  accessToken: string | undefined;
  categoryThingId: string;
  name: string;
}): Promise<{ status: "created" } | { status: "skipped"; reason: string }> {
  const { accessToken, categoryThingId, name } = options;
  if (!accessToken) return { status: "skipped", reason: "missing_access_token" };

  const trimmed = (name || "").trim();
  if (!trimmed) return { status: "skipped", reason: "missing_name" };

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/sql`;
  const surrealHeaders = getOptionalSurrealHeaders();

  const { table, id } = parseSurrealThingId(categoryThingId);
  if (!table || !id) return { status: "skipped", reason: "invalid_category_id" };

  const query = `CREATE account CONTENT {\n  name: ${JSON.stringify(trimmed)},\n  category_id: type::thing(${JSON.stringify(table)}, ${JSON.stringify(id)})\n};`;

  const res = await fetchLogged(
    url,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "text/plain",
        ...surrealHeaders,
      },
      body: query,
      cache: "no-store",
    },
    { name: "budgetingService.POST /sql (create account)" },
  );

  if (!res.ok) {
    const body = await safeText(res);
    return { status: "skipped", reason: `create_failed_${res.status}_${truncate(body)}` };
  }

  return { status: "created" };
}

function parseSurrealThingId(value: string): { table: string | null; id: string | null } {
  const v = (value || "").trim();
  const idx = v.indexOf(":");
  if (idx <= 0 || idx === v.length - 1) return { table: null, id: null };
  return { table: v.slice(0, idx), id: v.slice(idx + 1) };
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
