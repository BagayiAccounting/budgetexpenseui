import { fetchLogged } from "@/lib/http";

const DEFAULT_BASE_URL = "http://localhost:8001";

type SurrealQueryResult = { status?: string; time?: string; result?: unknown };

type CategoryRecord = {
  id: unknown;
  name?: unknown;
  parent_id?: unknown;
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
  parentId?: string;
  accounts: Array<{ id: string; name: string; tbAccount?: TbAccount }>;
  subcategories: CategoryWithAccounts[];
};

export type AccountType = "asset" | "expense" | "liability" | "revenue" | "equity";
const ACCOUNT_TYPES: AccountType[] = ["asset", "expense", "liability", "revenue", "equity"];

export type Account = {
  id: string;
  name: string;
  categoryName: string;
  categoryId: string;
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
    { name: "settingsService.POST /sql (list categories+accounts)" },
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

  const allCategories: CategoryWithAccounts[] = categoriesRaw
    .map((c) => {
      const id = thingIdToString(c.id);
      const name = typeof c.name === "string" ? c.name : "(Unnamed category)";
      const parentId = thingIdToString(c.parent_id);
      if (!id) return null;
      return {
        id,
        name,
        parentId,
        accounts: [] as Array<{ id: string; name: string; tbAccount?: TbAccount }> ,
        subcategories: [] as CategoryWithAccounts[],
      };
    })
    .filter(Boolean) as CategoryWithAccounts[];

  const byCategoryId = new Map<string, CategoryWithAccounts>();
  for (const c of allCategories) byCategoryId.set(c.id, c);

  const rootCategories: CategoryWithAccounts[] = [];
  for (const c of allCategories) {
    if (c.parentId) {
      const parent = byCategoryId.get(c.parentId);
      if (parent) {
        parent.subcategories.push(c);
        continue;
      }
    }
    rootCategories.push(c);
  }

  for (const a of accountsRaw) {
    const accountId = thingIdToString(a.id);
    const accountName = typeof a.name === "string" ? a.name : "(Unnamed account)";
    const categoryId = thingIdToString(a.category_id);
    if (!accountId || !categoryId) continue;
    const cat = byCategoryId.get(categoryId);
    if (!cat) continue;
    cat.accounts.push({ id: accountId, name: accountName, tbAccount: asTbAccount(a.tb_account) });
  }

  function sortCategoryTree(node: CategoryWithAccounts) {
    node.accounts.sort((a, b) => a.name.localeCompare(b.name));
    node.subcategories.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of node.subcategories) sortCategoryTree(child);
  }

  // Stable sort for nicer UI.
  rootCategories.sort((a, b) => a.name.localeCompare(b.name));
  for (const c of rootCategories) sortCategoryTree(c);

  return { status: "ok", categories: rootCategories };
}

export async function listAllAccounts(options: {
  accessToken: string | undefined;
}): Promise<{ status: "ok"; accounts: Account[] } | { status: "skipped"; reason: string }> {
  const { accessToken } = options;
  if (!accessToken) return { status: "skipped", reason: "missing_access_token" };

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/sql`;
  const surrealHeaders = getOptionalSurrealHeaders();

  const query = "SELECT *, category_id.name AS category_name FROM account;";

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
    { name: "settingsService.POST /sql (list all accounts)" },
  );

  if (!res.ok) {
    const body = await safeText(res);
    return { status: "skipped", reason: `list_failed_${res.status}_${truncate(body)}` };
  }

  const payload = await safeJson(res);
  const statements = parseSurrealSqlPayload(payload);
  if (!statements) return { status: "skipped", reason: "unrecognized_sql_response" };

  const accountsRaw = getResultArray<AccountRecord & { category_name?: string }>(statements[0]);

  const accounts: Account[] = accountsRaw
    .map((a) => {
      const id = thingIdToString(a.id);
      const name = typeof a.name === "string" ? a.name : "(Unnamed)";
      const categoryName = typeof a.category_name === "string" ? a.category_name : "(Unknown)";
      const categoryId = thingIdToString(a.category_id) || "";
      if (!id) return null;
      return { id, name, categoryName, categoryId };
    })
    .filter(Boolean) as Account[];

  return { status: "ok", accounts };
}

export async function createAccount(options: {
  accessToken: string | undefined;
  categoryThingId: string;
  name: string;
  type: AccountType;
}): Promise<{ status: "created" } | { status: "skipped"; reason: string }> {
  const { accessToken, categoryThingId, name, type } = options;
  if (!accessToken) return { status: "skipped", reason: "missing_access_token" };

  if (!ACCOUNT_TYPES.includes(type)) return { status: "skipped", reason: "invalid_type" };

  const trimmed = (name || "").trim();
  if (!trimmed) return { status: "skipped", reason: "missing_name" };

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/sql`;
  const surrealHeaders = getOptionalSurrealHeaders();

  const categoryLiteral = toSurrealThingLiteral(categoryThingId);
  if (!categoryLiteral) return { status: "skipped", reason: "invalid_category_id" };

  const query = `CREATE account CONTENT {\n  name: ${JSON.stringify(trimmed)},\n  category_id: ${categoryLiteral},\n  type: ${JSON.stringify(type)}\n};`;

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
    { name: "settingsService.POST /sql (create account)" },
  );

  if (!res.ok) {
    const body = await safeText(res);
    return { status: "skipped", reason: `create_failed_${res.status}_${truncate(body)}` };
  }

  const payload = await safeJson(res);
  const statements = parseSurrealSqlPayload(payload);
  if (!statements) return { status: "skipped", reason: "create_unrecognized_sql_response" };

  const first = statements[0];
  const created = getResultArray<unknown>(first);
  if (!created.length) {
    return { status: "skipped", reason: "create_empty_result" };
  }

  return { status: "created" };
}

export async function createSubCategory(options: {
  accessToken: string | undefined;
  userThingId: string;
  parentCategoryThingId: string;
  name: string;
}): Promise<{ status: "created" } | { status: "skipped"; reason: string }> {
  const { accessToken, userThingId, parentCategoryThingId, name } = options;
  if (!accessToken) return { status: "skipped", reason: "missing_access_token" };

  const trimmed = (name || "").trim();
  if (!trimmed) return { status: "skipped", reason: "missing_name" };

  const userLiteral = toSurrealThingLiteral(userThingId);
  if (!userLiteral) return { status: "skipped", reason: "invalid_user_id" };

  const parentLiteral = toSurrealThingLiteral(parentCategoryThingId);
  if (!parentLiteral) return { status: "skipped", reason: "invalid_parent_category_id" };

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/sql`;
  const surrealHeaders = getOptionalSurrealHeaders();

  const query = `CREATE category CONTENT {\n  name: ${JSON.stringify(trimmed)},\n  user_id: ${userLiteral},\n  parent_id: ${parentLiteral}\n};`;

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
    { name: "settingsService.POST /sql (create sub-category)" },
  );

  if (!res.ok) {
    const body = await safeText(res);
    return { status: "skipped", reason: `create_category_failed_${res.status}_${truncate(body)}` };
  }

  const payload = await safeJson(res);
  const statements = parseSurrealSqlPayload(payload);
  if (!statements) return { status: "skipped", reason: "create_category_unrecognized_sql_response" };

  const created = getResultArray<unknown>(statements[0]);
  if (!created.length) return { status: "skipped", reason: "create_category_empty_result" };

  return { status: "created" };
}

function parseSurrealThingId(value: string): { table: string | null; id: string | null } {
  const v = (value || "").trim();
  const idx = v.indexOf(":");
  if (idx <= 0 || idx === v.length - 1) return { table: null, id: null };
  return { table: v.slice(0, idx), id: v.slice(idx + 1) };
}

function toSurrealThingLiteral(value: string): string | null {
  const { table, id } = parseSurrealThingId(value);
  if (!table || !id) return null;
  // Inserted unquoted into SQL; allow only safe characters.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) return null;
  if (!/^[A-Za-z0-9_]+$/.test(id)) return null;
  return `${table}:${id}`;
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
