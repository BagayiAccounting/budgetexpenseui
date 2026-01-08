import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import TransactionsClient from "@/components/TransactionsClient";
import { listAllAccounts } from "@/lib/settingsService";
import { executeSurrealQL, getResultArray, thingIdToString } from "@/lib/surrealdb";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ categoryId?: string }>;
}) {
  const session = await auth0.getSession();
  if (!session?.user) {
    redirect("/");
  }

  const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
  const scope = process.env.AUTH0_SCOPE;
  const accessTokenOptions = {
    ...(audience ? { audience } : {}),
    ...(scope ? { scope } : {}),
  };

  const params = await searchParams;
  const categoryId = params.categoryId;

  type Transfer = {
    id: string;
    fromAccountName: string;
    toAccountName: string;
    amount: number;
    type: string;
    status: string;
    label?: string;
    description?: string;
    createdAt: string;
  };

  let accountsData;
  let categoriesData: { id: string; name: string }[] = [];
  let transfersData: Transfer[] = [];

  try {
    const { token } = await auth0.getAccessToken(accessTokenOptions);
    accountsData = await listAllAccounts({ accessToken: token });

    // Fetch categories
    const categoriesQuery = "SELECT id, name FROM category WHERE parent_id = NONE;";
    const categoriesResult = await executeSurrealQL({
      token,
      query: categoriesQuery,
      logName: "transactionsPage.POST /sql (list categories)",
    });

    if (categoriesResult.success) {
      const categoriesRaw = getResultArray<{ id?: unknown; name?: unknown }>(categoriesResult.data[0]);
      categoriesData = categoriesRaw
        .map((c) => ({
          id: thingIdToString(c.id) || "",
          name: typeof c.name === "string" ? c.name : "(Unnamed)",
        }))
        .filter((c) => c.id);
    }

    // Fetch transfers for selected category
    const selectedCategoryId = categoryId || categoriesData[0]?.id;
    if (selectedCategoryId) {
      const transfersQuery = `
        SELECT *,
          from_account_id.name AS from_account_name,
          to_account_id.name AS to_account_name
        FROM transfer
        WHERE from_account_id.category_id = ${selectedCategoryId}
           OR to_account_id.category_id = ${selectedCategoryId}
        ORDER BY created_at DESC
        LIMIT 100;
      `;

      const transfersResult = await executeSurrealQL({
        token,
        query: transfersQuery,
        logName: "transactionsPage.POST /sql (list transfers)",
      });

      if (transfersResult.success) {
        const transfersRaw = getResultArray<Record<string, unknown>>(transfersResult.data[0]);
        transfersData = transfersRaw
          .map((t) => ({
            id: thingIdToString(t.id) || "",
            fromAccountName: typeof t.from_account_name === "string" ? t.from_account_name : "(Unknown)",
            toAccountName: typeof t.to_account_name === "string" ? t.to_account_name : "(Unknown)",
            amount:
              typeof t.amount === "number"
                ? t.amount
                : typeof t.amount === "string"
                  ? parseFloat(t.amount)
                  : 0,
            type: typeof t.type === "string" ? t.type : "payment",
            status: typeof t.status === "string" ? t.status : "draft",
            label: typeof t.label === "string" ? t.label : undefined,
            description: typeof t.description === "string" ? t.description : undefined,
            createdAt: typeof t.created_at === "string" ? t.created_at : "",
          }))
          .filter((t) => t.id);
      }
    }
  } catch {
    accountsData = { status: "skipped" as const, reason: "token_or_fetch_failed" };
  }

  const accounts = accountsData.status === "ok" ? accountsData.accounts : [];

  return (
    <TransactionsClient
      accounts={accounts}
      categories={categoriesData}
      transfers={transfersData}
      initialCategoryId={categoryId || null}
    />
  );
}
