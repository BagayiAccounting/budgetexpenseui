import {
  executeSurrealQL,
  getResultArray,
  thingIdToString,
  toSurrealThingLiteral,
} from "@/lib/surrealdb";

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
  balance?: string;
};

function asTbAccount(value: unknown): TbAccount | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  // Check if it's wrapped in a response object
  if (obj.data && typeof obj.data === "object") {
    return obj.data as TbAccount;
  }
  return value as TbAccount;
}

export async function listCategoriesWithAccounts(options: {
  accessToken: string | undefined;
}): Promise<{ status: "ok"; categories: CategoryWithAccounts[] } | { status: "skipped"; reason: string }> {
  const { accessToken } = options;
  if (!accessToken) return { status: "skipped", reason: "missing_access_token" };

  const query = "SELECT * FROM category; SELECT *, fn::tb_account(tb_account_id) AS tb_account FROM account;";

  const result = await executeSurrealQL({
    token: accessToken,
    query,
    logName: "settingsService.POST /sql (list categories+accounts)",
  });

  if (!result.success) {
    return { status: "skipped", reason: result.error };
  }

  const categoriesRaw = getResultArray<CategoryRecord>(result.data[0]);
  const accountsRaw = getResultArray<AccountRecord>(result.data[1]);

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
        accounts: [] as Array<{ id: string; name: string; tbAccount?: TbAccount }>,
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

  rootCategories.sort((a, b) => a.name.localeCompare(b.name));
  for (const c of rootCategories) sortCategoryTree(c);

  return { status: "ok", categories: rootCategories };
}

export async function listAllAccounts(options: {
  accessToken: string | undefined;
}): Promise<{ status: "ok"; accounts: Account[] } | { status: "skipped"; reason: string }> {
  const { accessToken } = options;
  if (!accessToken) return { status: "skipped", reason: "missing_access_token" };

  const query = "SELECT *, category_id.name AS category_name, fn::tb_account(tb_account_id) AS tb_account FROM account;";

  const result = await executeSurrealQL({
    token: accessToken,
    query,
    logName: "settingsService.POST /sql (list all accounts)",
  });

  if (!result.success) {
    return { status: "skipped", reason: result.error };
  }

  const accountsRaw = getResultArray<AccountRecord & { category_name?: string }>(result.data[0]);

  const accounts: Account[] = accountsRaw
    .map((a) => {
      const id = thingIdToString(a.id);
      const name = typeof a.name === "string" ? a.name : "(Unnamed)";
      const categoryName = typeof a.category_name === "string" ? a.category_name : "(Unknown)";
      const categoryId = thingIdToString(a.category_id) || "";
      const tbAccount = asTbAccount(a.tb_account);
      const balance = tbAccount?.book_balance;
      if (!id) return null;
      return { id, name, categoryName, categoryId, balance };
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

  const categoryLiteral = toSurrealThingLiteral(categoryThingId);
  if (!categoryLiteral) return { status: "skipped", reason: "invalid_category_id" };

  const query = `CREATE account CONTENT {\n  name: ${JSON.stringify(trimmed)},\n  category_id: ${categoryLiteral},\n  type: ${JSON.stringify(type)}\n};`;

  const result = await executeSurrealQL({
    token: accessToken,
    query,
    logName: "settingsService.POST /sql (create account)",
  });

  if (!result.success) {
    return { status: "skipped", reason: result.error };
  }

  const created = getResultArray<unknown>(result.data[0]);
  if (!created.length) {
    return { status: "skipped", reason: "create_empty_result" };
  }

  return { status: "created" };
}

export async function createCategory(options: {
  accessToken: string | undefined;
  userThingId: string;
  name: string;
}): Promise<{ status: "created" } | { status: "skipped"; reason: string }> {
  const { accessToken, userThingId, name } = options;
  if (!accessToken) return { status: "skipped", reason: "missing_access_token" };

  const trimmed = (name || "").trim();
  if (!trimmed) return { status: "skipped", reason: "missing_name" };

  const userLiteral = toSurrealThingLiteral(userThingId);
  if (!userLiteral) return { status: "skipped", reason: "invalid_user_id" };

  const query = `CREATE category CONTENT {\n  name: ${JSON.stringify(trimmed)},\n  user_id: ${userLiteral}\n};`;

  const result = await executeSurrealQL({
    token: accessToken,
    query,
    logName: "settingsService.POST /sql (create category)",
  });

  if (!result.success) {
    return { status: "skipped", reason: result.error };
  }

  const created = getResultArray<unknown>(result.data[0]);
  if (!created.length) return { status: "skipped", reason: "create_category_empty_result" };

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

  const query = `CREATE category CONTENT {\n  name: ${JSON.stringify(trimmed)},\n  user_id: ${userLiteral},\n  parent_id: ${parentLiteral}\n};`;

  const result = await executeSurrealQL({
    token: accessToken,
    query,
    logName: "settingsService.POST /sql (create sub-category)",
  });

  if (!result.success) {
    return { status: "skipped", reason: result.error };
  }

  const created = getResultArray<unknown>(result.data[0]);
  if (!created.length) return { status: "skipped", reason: "create_category_empty_result" };

  return { status: "created" };
}
