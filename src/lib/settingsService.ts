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
  default_account_id?: unknown;
};

type AccountRecord = {
  id: unknown;
  name?: unknown;
  category_id?: unknown;
  tb_account?: unknown;
  type?: unknown;
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
  defaultAccountId?: string;
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
  type?: string;
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

  // Query WITHOUT TigerBeetle balances for fast initial load
  // Balances will be fetched separately using fn::tb_accounts batch call
  const query = "SELECT * FROM category; SELECT * FROM account;";

  const result = await executeSurrealQL({
    token: accessToken,
    query,
    logName: "settingsService.POST /sql (list categories+accounts - no balances)",
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
      const defaultAccountId = thingIdToString(c.default_account_id);
      if (!id) return null;
      return {
        id,
        name,
        parentId,
        defaultAccountId,
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
}): Promise<{ status: "ok"; accounts: Account[]; externalAccountId?: string } | { status: "skipped"; reason: string }> {
  const { accessToken } = options;
  if (!accessToken) return { status: "skipped", reason: "missing_access_token" };

  // Fetch all accounts WITHOUT TigerBeetle balance (for performance - avoids N network calls)
  // Also fetch the external account ID using $external_account
  const query = `
    SELECT *, category_id.name AS category_name FROM account;
    LET $ext_id = $external_account;
    SELECT id FROM account WHERE id = $ext_id LIMIT 1;
  `;

  const result = await executeSurrealQL({
    token: accessToken,
    query,
    logName: "settingsService.POST /sql (list all accounts)",
  });

  if (!result.success) {
    return { status: "skipped", reason: result.error };
  }

  const accountsRaw = getResultArray<AccountRecord & { category_name?: string }>(result.data[0]);
  
  // Get the external account from the third query result (index 2, since index 1 is LET)
  const externalAccountArr = getResultArray<{ id: unknown }>(result.data[2]);
  const externalAccountResult = externalAccountArr.length > 0 ? externalAccountArr[0] : null;

  // Process regular accounts (without balance since we're not fetching TigerBeetle data)
  const accounts: Account[] = accountsRaw
    .map((a) => {
      const id = thingIdToString(a.id);
      const name = typeof a.name === "string" ? a.name : "(Unnamed)";
      const categoryName = typeof a.category_name === "string" ? a.category_name : "(Unknown)";
      const categoryId = thingIdToString(a.category_id) || "";
      const accountType = typeof a.type === "string" ? a.type : undefined;
      if (!id) return null;
      // Note: balance is no longer fetched for performance - it will be undefined
      return { id, name, categoryName, categoryId, type: accountType };
    })
    .filter(Boolean) as Account[];

  // Get external account ID
  const externalAccountId = externalAccountResult ? thingIdToString(externalAccountResult.id) : undefined;

  // Add external account if it exists and isn't already in the list
  if (externalAccountId && !accounts.some(a => a.id === externalAccountId)) {
    // Find the external account from the accounts list or create a minimal entry
    accounts.push({
      id: externalAccountId,
      name: "External Account",
      categoryName: "(External)",
      categoryId: "",
      type: undefined,
    });
  }

  return { status: "ok", accounts, externalAccountId };
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
    return { status: "skipped", reason: "permission_denied_create_account" };
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
  if (!created.length) return { status: "skipped", reason: "permission_denied_create_category" };

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
  if (!created.length) return { status: "skipped", reason: "permission_denied_create_subcategory" };

  return { status: "created" };
}

// Batch fetch TigerBeetle balances for multiple accounts using fn::tb_accounts
// Returns a map of account_id -> TbAccount
export type AccountBalancesMap = Record<string, TbAccount>;

export async function fetchAccountBalancesBatch(options: {
  accessToken: string | undefined;
  accountIds: string[];
}): Promise<{ status: "ok"; balances: AccountBalancesMap } | { status: "skipped"; reason: string }> {
  const { accessToken, accountIds } = options;
  if (!accessToken) return { status: "skipped", reason: "missing_access_token" };
  if (!accountIds.length) return { status: "ok", balances: {} };

  // Convert account IDs to SurrealDB thing literals
  const accountLiterals = accountIds
    .map((id) => toSurrealThingLiteral(id))
    .filter(Boolean);

  if (!accountLiterals.length) return { status: "ok", balances: {} };

  // Use fn::tb_accounts to fetch all balances in one batch call
  // The function takes an array of account IDs and returns a map of id -> balance info
  const query = `RETURN fn::tb_accounts([${accountLiterals.join(", ")}]);`;

  const result = await executeSurrealQL({
    token: accessToken,
    query,
    logName: "settingsService.POST /sql (batch fetch balances)",
  });

  if (!result.success) {
    return { status: "skipped", reason: result.error };
  }

  // fn::tb_accounts returns an object/map where keys are account IDs and values are TbAccount objects
  const responseData = result.data[0];
  const balances: AccountBalancesMap = {};

  if (responseData && typeof responseData === "object") {
    // Handle the response - it could be the direct map or wrapped in a result
    const balanceMap = (responseData as Record<string, unknown>).result ?? responseData;
    
    if (balanceMap && typeof balanceMap === "object") {
      for (const [key, value] of Object.entries(balanceMap as Record<string, unknown>)) {
        const tbAccount = asTbAccount(value);
        if (tbAccount) {
          // The key might be the full thing ID (e.g., "account:xyz") or just the ID
          balances[key] = tbAccount;
        }
      }
    }
  }

  return { status: "ok", balances };
}

