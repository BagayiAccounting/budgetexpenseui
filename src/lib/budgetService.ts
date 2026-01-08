import { fetchLogged } from "@/lib/http";

const DEFAULT_BASE_URL = "http://localhost:8001";

type SurrealQueryResult = { status?: string; time?: string; result?: unknown };

type BudgetTemplateRecord = {
  id: unknown;
  name?: unknown;
  category_id?: unknown;
  total_amount?: unknown;
  start_at?: unknown;
  status?: unknown;
  schedule_id?: unknown;
  created_at?: unknown;
};

type BudgetRecord = {
  id: unknown;
  template_id?: unknown;
  total_amount?: unknown;
  start_at?: unknown;
  end_at?: unknown;
  status?: unknown;
  created_at?: unknown;
};

type BudgetAllocationRecord = {
  id: unknown;
  budget_id?: unknown;
  account_id?: unknown;
  amount?: unknown;
};

type AccountRecord = {
  id: unknown;
  name?: unknown;
  category_id?: unknown;
};

type CategoryRecord = {
  id: unknown;
  name?: unknown;
  parent_id?: unknown;
};

export type BudgetTemplate = {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  totalAmount: number;
  startAt: string;
  status: string;
  scheduleId?: string;
  createdAt: string;
};

export type Budget = {
  id: string;
  templateId: string;
  totalAmount: number;
  startAt: string;
  endAt: string;
  status: string;
  createdAt: string;
};

export type BudgetAllocation = {
  id: string;
  budgetId: string;
  accountId: string;
  accountName: string;
  amount: number;
};

export type BudgetTemplateWithAllocations = BudgetTemplate & {
  allocations: BudgetAllocation[];
  accounts: Array<{ id: string; name: string; defaultAccountId?: string }>;
};

export type CategoryWithBudgets = {
  id: string;
  name: string;
  parentId?: string;
  budgetTemplates: BudgetTemplate[];
  budgets: Budget[];
  subcategories: CategoryWithBudgets[];
};

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

export async function listCategoriesWithBudgets(options: {
  accessToken: string | undefined;
}): Promise<{ status: "ok"; categories: CategoryWithBudgets[] } | { status: "skipped"; reason: string }> {
  const { accessToken } = options;
  if (!accessToken) return { status: "skipped", reason: "missing_access_token" };

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/sql`;
  const surrealHeaders = getOptionalSurrealHeaders();

  const query = `
    SELECT * FROM category;
    SELECT *, category_id.name AS category_name FROM budget_template;
    SELECT * FROM budget;
  `;

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
    { name: "budgetService.POST /sql (list categories+budgets)" },
  );

  if (!res.ok) {
    const body = await safeText(res);
    return { status: "skipped", reason: `list_failed_${res.status}_${truncate(body)}` };
  }

  const payload = await safeJson(res);
  const statements = parseSurrealSqlPayload(payload);
  if (!statements) return { status: "skipped", reason: "unrecognized_sql_response" };

  const categoriesRaw = getResultArray<CategoryRecord>(statements[0]);
  const templatesRaw = getResultArray<BudgetTemplateRecord & { category_name?: string }>(statements[1]);
  const budgetsRaw = getResultArray<BudgetRecord>(statements[2]);

  const allCategories: CategoryWithBudgets[] = categoriesRaw
    .map((c) => {
      const id = thingIdToString(c.id);
      const name = typeof c.name === "string" ? c.name : "(Unnamed category)";
      const parentId = thingIdToString(c.parent_id);
      if (!id) return null;
      return {
        id,
        name,
        parentId,
        budgetTemplates: [] as BudgetTemplate[],
        budgets: [] as Budget[],
        subcategories: [] as CategoryWithBudgets[],
      };
    })
    .filter(Boolean) as CategoryWithBudgets[];

  const byCategoryId = new Map<string, CategoryWithBudgets>();
  for (const c of allCategories) byCategoryId.set(c.id, c);

  const rootCategories: CategoryWithBudgets[] = [];
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

  // Map budget templates to categories
  const templatesByCategory = new Map<string, BudgetTemplate[]>();
  for (const t of templatesRaw) {
    const templateId = thingIdToString(t.id);
    const categoryId = thingIdToString(t.category_id);
    if (!templateId || !categoryId) continue;

    const template: BudgetTemplate = {
      id: templateId,
      name: typeof t.name === "string" ? t.name : "(Unnamed)",
      categoryId,
      categoryName: typeof t.category_name === "string" ? t.category_name : "(Unknown)",
      totalAmount: typeof t.total_amount === "number" ? t.total_amount : (typeof t.total_amount === "string" ? parseFloat(t.total_amount) : 0),
      startAt: typeof t.start_at === "string" ? t.start_at : "",
      status: typeof t.status === "string" ? t.status : "active",
      scheduleId: thingIdToString(t.schedule_id),
      createdAt: typeof t.created_at === "string" ? t.created_at : "",
    };

    if (!templatesByCategory.has(categoryId)) {
      templatesByCategory.set(categoryId, []);
    }
    templatesByCategory.get(categoryId)!.push(template);
  }

  // Map budgets by template_id
  const budgetsByTemplate = new Map<string, Budget[]>();
  for (const b of budgetsRaw) {
    const budgetId = thingIdToString(b.id);
    const templateId = thingIdToString(b.template_id);
    if (!budgetId || !templateId) continue;

    const budget: Budget = {
      id: budgetId,
      templateId,
      totalAmount: typeof b.total_amount === "number" ? b.total_amount : 0,
      startAt: typeof b.start_at === "string" ? b.start_at : "",
      endAt: typeof b.end_at === "string" ? b.end_at : "",
      status: typeof b.status === "string" ? b.status : "active",
      createdAt: typeof b.created_at === "string" ? b.created_at : "",
    };

    if (!budgetsByTemplate.has(templateId)) {
      budgetsByTemplate.set(templateId, []);
    }
    budgetsByTemplate.get(templateId)!.push(budget);
  }

  // Assign templates and budgets to categories
  for (const cat of allCategories) {
    const templates = templatesByCategory.get(cat.id) || [];
    cat.budgetTemplates = templates;

    // Get all budgets for this category's templates
    const allBudgets: Budget[] = [];
    for (const template of templates) {
      const budgets = budgetsByTemplate.get(template.id) || [];
      allBudgets.push(...budgets);
    }
    cat.budgets = allBudgets;
  }

  function sortCategoryTree(node: CategoryWithBudgets) {
    node.budgetTemplates.sort((a, b) => b.startAt.localeCompare(a.startAt));
    node.budgets.sort((a, b) => b.startAt.localeCompare(a.startAt));
    node.subcategories.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of node.subcategories) sortCategoryTree(child);
  }

  rootCategories.sort((a, b) => a.name.localeCompare(b.name));
  for (const c of rootCategories) sortCategoryTree(c);

  return { status: "ok", categories: rootCategories };
}

export async function createBudgetTemplate(options: {
  accessToken: string | undefined;
  categoryThingId: string;
  name: string;
  totalAmount: number;
  startAt: string;
  status?: string;
}): Promise<{ status: "created"; id: string } | { status: "skipped"; reason: string }> {
  const { accessToken, categoryThingId, name, totalAmount, startAt, status = "active" } = options;
  if (!accessToken) return { status: "skipped", reason: "missing_access_token" };

  if (totalAmount <= 0) return { status: "skipped", reason: "invalid_amount" };
  if (!startAt) return { status: "skipped", reason: "missing_start_date" };
  if (!name.trim()) return { status: "skipped", reason: "missing_name" };

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/sql`;
  const surrealHeaders = getOptionalSurrealHeaders();

  const categoryLiteral = toSurrealThingLiteral(categoryThingId);
  if (!categoryLiteral) return { status: "skipped", reason: "invalid_category_id" };

  const query = `CREATE budget_template CONTENT {
    name: ${JSON.stringify(name.trim())},
    category_id: ${categoryLiteral},
    total_amount: ${totalAmount},
    start_at: <datetime> ${JSON.stringify(startAt)},
    status: ${JSON.stringify(status)}
  };`;

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
    { name: "budgetService.POST /sql (create budget_template)" },
  );

  if (!res.ok) {
    const body = await safeText(res);
    return { status: "skipped", reason: `create_failed_${res.status}_${truncate(body)}` };
  }

  const payload = await safeJson(res);
  const statements = parseSurrealSqlPayload(payload);
  if (!statements) return { status: "skipped", reason: "create_unrecognized_sql_response" };

  const first = statements[0];
  
  // Check if the first statement has an error status
  if (first?.status === "ERR") {
    const errorResult = first.result;
    if (typeof errorResult === "string") {
      // Extract user-friendly error message
      const match = errorResult.match(/An error occurred: (.+)/);
      if (match) {
        return { status: "skipped", reason: match[1] };
      }
      return { status: "skipped", reason: errorResult };
    }
    return { status: "skipped", reason: "database_error" };
  }
  
  const created = getResultArray<{ id: unknown }>(first);
  if (!created.length) {
    return { status: "skipped", reason: "create_empty_result" };
  }

  const createdId = thingIdToString(created[0].id);
  if (!createdId) return { status: "skipped", reason: "invalid_created_id" };

  return { status: "created", id: createdId };
}

export async function createBudget(options: {
  accessToken: string | undefined;
  templateThingId: string;
  totalAmount: number;
  startAt: string;
  endAt: string;
  status?: string;
}): Promise<{ status: "created"; id: string } | { status: "skipped"; reason: string }> {
  const { accessToken, templateThingId, totalAmount, startAt, endAt, status = "active" } = options;
  if (!accessToken) return { status: "skipped", reason: "missing_access_token" };

  if (totalAmount <= 0) return { status: "skipped", reason: "invalid_amount" };
  if (!startAt || !endAt) return { status: "skipped", reason: "missing_dates" };

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/sql`;
  const surrealHeaders = getOptionalSurrealHeaders();

  const templateLiteral = toSurrealThingLiteral(templateThingId);
  if (!templateLiteral) return { status: "skipped", reason: "invalid_template_id" };

  const query = `CREATE budget CONTENT {
    template_id: ${templateLiteral},
    total_amount: ${totalAmount},
    start_at: <datetime> ${JSON.stringify(startAt)},
    end_at: <datetime> ${JSON.stringify(endAt)},
    status: ${JSON.stringify(status)}
  };`;

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
    { name: "budgetService.POST /sql (create budget)" },
  );

  if (!res.ok) {
    const body = await safeText(res);
    return { status: "skipped", reason: `create_failed_${res.status}_${truncate(body)}` };
  }

  const payload = await safeJson(res);
  const statements = parseSurrealSqlPayload(payload);
  if (!statements) return { status: "skipped", reason: "create_unrecognized_sql_response" };

  const first = statements[0];
  const created = getResultArray<{ id: unknown }>(first);
  if (!created.length) {
    return { status: "skipped", reason: "create_empty_result" };
  }

  const createdId = thingIdToString(created[0].id);
  if (!createdId) return { status: "skipped", reason: "invalid_created_id" };

  return { status: "created", id: createdId };
}

export async function getBudgetTemplateWithAllocations(options: {
  accessToken: string | undefined;
  templateThingId: string;
}): Promise<{ status: "ok"; template: BudgetTemplateWithAllocations } | { status: "skipped"; reason: string }> {
  const { accessToken, templateThingId } = options;
  if (!accessToken) return { status: "skipped", reason: "missing_access_token" };

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/sql`;
  const surrealHeaders = getOptionalSurrealHeaders();

  console.log("[budgetService] getBudgetTemplateWithAllocations - input templateThingId:", templateThingId);
  const parsed = parseSurrealThingId(templateThingId);
  console.log("[budgetService] parsed ID:", parsed);
  
  const templateLiteral = toSurrealThingLiteral(templateThingId);
  console.log("[budgetService] templateLiteral result:", templateLiteral);
  
  if (!templateLiteral) return { status: "skipped", reason: "invalid_template_id" };

  const query = `
    SELECT *, category_id.name AS category_name FROM budget_template WHERE id = ${templateLiteral};
    SELECT *, account_id.name AS account_name FROM budget_allocation WHERE budget_id = ${templateLiteral};
    SELECT id, name FROM account WHERE category_id = (SELECT VALUE category_id FROM budget_template WHERE id = ${templateLiteral} LIMIT 1)[0] AND id != (SELECT VALUE default_account_id FROM (SELECT VALUE category_id FROM budget_template WHERE id = ${templateLiteral} LIMIT 1)[0])[0];
    SELECT id, name, default_account_id FROM category WHERE parent_id = (SELECT VALUE category_id FROM budget_template WHERE id = ${templateLiteral} LIMIT 1)[0];
  `;

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
    { name: "budgetService.POST /sql (get template with allocations)" },
  );

  if (!res.ok) {
    const body = await safeText(res);
    return { status: "skipped", reason: `fetch_failed_${res.status}_${truncate(body)}` };
  }

  const payload = await safeJson(res);
  const statements = parseSurrealSqlPayload(payload);
  if (!statements || statements.length < 3) return { status: "skipped", reason: "unrecognized_sql_response" };

  const templateRaw = getResultArray<BudgetTemplateRecord & { category_name?: string }>(statements[0])[0];
  if (!templateRaw) return { status: "skipped", reason: "template_not_found" };

  const allocationsRaw = getResultArray<BudgetAllocationRecord & { account_name?: string }>(statements[1]);
  const accountsRaw = getResultArray<AccountRecord>(statements[2]);
  const subcategoriesRaw = getResultArray<CategoryRecord & { default_account_id?: unknown }>(statements[3]);

  const templateId = thingIdToString(templateRaw.id);
  const categoryId = thingIdToString(templateRaw.category_id);
  if (!templateId || !categoryId) return { status: "skipped", reason: "invalid_template_data" };

  const allocations: BudgetAllocation[] = allocationsRaw.map((a) => ({
    id: thingIdToString(a.id) || "",
    budgetId: thingIdToString(a.budget_id) || "",
    accountId: thingIdToString(a.account_id) || "",
    accountName: typeof a.account_name === "string" ? a.account_name : "(Unknown)",
    amount: typeof a.amount === "number" ? a.amount : (typeof a.amount === "string" ? parseFloat(a.amount) : 0),
  })).filter(a => a.id);

  // Combine regular accounts and subcategory default accounts
  const accounts = [
    ...accountsRaw.map((a) => ({
      id: thingIdToString(a.id) || "",
      name: typeof a.name === "string" ? a.name : "(Unnamed)",
    })).filter(a => a.id),
    ...subcategoriesRaw.map((sc) => {
      const defaultAccountId = thingIdToString(sc.default_account_id);
      return {
        id: defaultAccountId || "",
        name: typeof sc.name === "string" ? sc.name : "(Unnamed subcategory)",
        defaultAccountId,
      };
    }).filter(a => a.id),
  ];

  const template: BudgetTemplateWithAllocations = {
    id: templateId,
    name: typeof templateRaw.name === "string" ? templateRaw.name : "(Unnamed)",
    categoryId,
    categoryName: typeof templateRaw.category_name === "string" ? templateRaw.category_name : "(Unknown)",
    totalAmount: typeof templateRaw.total_amount === "number" ? templateRaw.total_amount : (typeof templateRaw.total_amount === "string" ? parseFloat(templateRaw.total_amount) : 0),
    startAt: typeof templateRaw.start_at === "string" ? templateRaw.start_at : "",
    status: typeof templateRaw.status === "string" ? templateRaw.status : "active",
    scheduleId: thingIdToString(templateRaw.schedule_id),
    createdAt: typeof templateRaw.created_at === "string" ? templateRaw.created_at : "",
    allocations,
    accounts,
  };

  return { status: "ok", template };
}

export async function createBudgetAllocation(options: {
  accessToken: string | undefined;
  budgetTemplateThingId: string;
  accountThingId: string;
  amount: number;
}): Promise<{ status: "created"; id: string } | { status: "skipped"; reason: string }> {
  const { accessToken, budgetTemplateThingId, accountThingId, amount } = options;
  if (!accessToken) return { status: "skipped", reason: "missing_access_token" };

  if (amount <= 0) return { status: "skipped", reason: "invalid_amount" };

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/sql`;
  const surrealHeaders = getOptionalSurrealHeaders();

  const budgetLiteral = toSurrealThingLiteral(budgetTemplateThingId);
  const accountLiteral = toSurrealThingLiteral(accountThingId);
  if (!budgetLiteral) return { status: "skipped", reason: "invalid_budget_id" };
  if (!accountLiteral) return { status: "skipped", reason: "invalid_account_id" };

  const query = `CREATE budget_allocation CONTENT {
    budget_id: ${budgetLiteral},
    account_id: ${accountLiteral},
    amount: ${amount}
  };`;

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
    { name: "budgetService.POST /sql (create budget_allocation)" },
  );

  if (!res.ok) {
    const body = await safeText(res);
    return { status: "skipped", reason: `create_failed_${res.status}_${truncate(body)}` };
  }

  const payload = await safeJson(res);
  const statements = parseSurrealSqlPayload(payload);
  if (!statements) return { status: "skipped", reason: "create_unrecognized_sql_response" };

  const first = statements[0];
  
  // Check if the first statement has an error status
  if (first?.status === "ERR") {
    const errorResult = first.result;
    if (typeof errorResult === "string") {
      // Extract user-friendly error message
      const match = errorResult.match(/An error occurred: (.+)/);
      if (match) {
        return { status: "skipped", reason: match[1] };
      }
      return { status: "skipped", reason: errorResult };
    }
    return { status: "skipped", reason: "database_error" };
  }
  
  const created = getResultArray<{ id: unknown }>(first);
  if (!created.length) {
    return { status: "skipped", reason: "create_empty_result" };
  }

  const createdId = thingIdToString(created[0].id);
  if (!createdId) return { status: "skipped", reason: "invalid_created_id" };

  return { status: "created", id: createdId };
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
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) return null;
  // SurrealDB IDs can contain alphanumeric characters
  if (!/^[A-Za-z0-9]+$/.test(id)) return null;
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
