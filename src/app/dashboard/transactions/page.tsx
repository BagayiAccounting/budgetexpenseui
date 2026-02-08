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
    fromAccountId: string;
    toAccountId?: string;
    fromAccountName: string;
    toAccountName: string;
    amount: number;
    type: string;
    status: string;
    label?: string;
    description?: string;
    createdAt: string;
    updatedAt?: string;
    createdBy?: string;
    createdByName?: string;
    externalTransactionId?: string;
    tbTransferId?: string;
    parentTransferId?: string;
    linkRole?: string;
    paymentIntegrationLink?: string;
    metadata?: Record<string, unknown>;
    paymentChannel?: Record<string, unknown>;
  };

  let accountsData;
  let categoriesData: { 
    id: string; 
    name: string; 
    isLinked: boolean; 
    defaultAccountId?: string; 
    paymentIntegrationId?: string;
    hasB2cPaybill?: boolean;
    b2cPaybillId?: string;
    paybillName?: string;
    b2cPaybillName?: string;
  }[] = [];
  let transfersData: Transfer[] = [];

  try {
    const { token } = await auth0.getAccessToken(accessTokenOptions);
    accountsData = await listAllAccounts({ accessToken: token });

    // Fetch categories with payment integration link status, default account, and b2c_paybill info
    const categoriesQuery = `
      SELECT 
        id, 
        name, 
        default_account_id, 
        fn::category_linked_payment_integration(id) AS payment_integration,
        fn::category_linked_payment_integration(id).out AS integration_record,
        fn::category_linked_payment_integration(id).out.b2c_paybill AS b2c_paybill,
        fn::category_linked_payment_integration(id).out.paybill_name AS paybill_name,
        fn::category_linked_payment_integration(id).out.b2c_paybill.paybill_name AS b2c_paybill_name
      FROM category 
      WHERE parent_id = NONE;
    `;
    const categoriesResult = await executeSurrealQL({
      token,
      query: categoriesQuery,
      logName: "transactionsPage.POST /sql (list categories)",
    });

    if (categoriesResult.success) {
      const categoriesRaw = getResultArray<{ 
        id?: unknown; 
        name?: unknown; 
        payment_integration?: unknown; 
        default_account_id?: unknown;
        integration_record?: unknown;
        b2c_paybill?: unknown;
        paybill_name?: unknown;
        b2c_paybill_name?: unknown;
      }>(categoriesResult.data[0]);
      categoriesData = categoriesRaw
        .map((c) => ({
          id: thingIdToString(c.id) || "",
          name: typeof c.name === "string" ? c.name : "(Unnamed)",
          isLinked: c.payment_integration != null,
          defaultAccountId: thingIdToString(c.default_account_id) || undefined,
          paymentIntegrationId: thingIdToString(c.integration_record) || undefined,
          hasB2cPaybill: c.b2c_paybill != null,
          b2cPaybillId: thingIdToString(c.b2c_paybill) || undefined,
          paybillName: typeof c.paybill_name === "string" ? c.paybill_name : undefined,
          b2cPaybillName: typeof c.b2c_paybill_name === "string" ? c.b2c_paybill_name : undefined,
        }))
        .filter((c) => c.id);
    }

    // Get the external account ID
    const externalAccountIdForQuery = accountsData.status === "ok" ? accountsData.externalAccountId : undefined;

    // Fetch transfers for selected category
    const selectedCategoryId = categoryId || categoriesData[0]?.id;
    if (selectedCategoryId) {
      const transfersQuery = `
        SELECT *,
          from_account_id.name AS from_account_name,
          to_account_id.name AS to_account_name,
          from_account_id.category_id.name AS from_category_name,
          to_account_id.category_id.name AS to_category_name,
          from_account_id.category_id.default_account_id AS from_category_default_account,
          to_account_id.category_id.default_account_id AS to_category_default_account,
          from_account_id AS from_account_ref,
          to_account_id AS to_account_ref,
          created_by.name AS created_by_name,
          metadata,
          payment_channel
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
          .map((t) => {
            const fromAccountId = thingIdToString(t.from_account_ref);
            const toAccountId = thingIdToString(t.to_account_ref);
            const fromCategoryDefaultAccount = thingIdToString(t.from_category_default_account);
            const toCategoryDefaultAccount = thingIdToString(t.to_category_default_account);
            
            // Get metadata for external account name
            const metadata = t.metadata as Record<string, unknown> | undefined;
            const externalAccountData = metadata?.external_account as Record<string, unknown> | undefined;
            const externalAccountName = typeof externalAccountData?.name === "string" ? externalAccountData.name : null;
            
            // Check if account is external account
            const isFromExternal = externalAccountIdForQuery && fromAccountId === externalAccountIdForQuery;
            const isToExternal = externalAccountIdForQuery && toAccountId === externalAccountIdForQuery;
            
            // If account is the default account for its category, show category name
            const isFromDefault = fromAccountId && fromCategoryDefaultAccount && fromAccountId === fromCategoryDefaultAccount;
            const isToDefault = toAccountId && toCategoryDefaultAccount && toAccountId === toCategoryDefaultAccount;
            
            // Determine display name for "from" account
            let fromDisplayName: string;
            if (isFromExternal && externalAccountName) {
              fromDisplayName = externalAccountName;
            } else if (isFromDefault && typeof t.from_category_name === "string") {
              fromDisplayName = t.from_category_name;
            } else {
              fromDisplayName = typeof t.from_account_name === "string" ? t.from_account_name : "(Unknown)";
            }
            
            // Determine display name for "to" account
            let toDisplayName: string;
            if (isToExternal && externalAccountName) {
              toDisplayName = externalAccountName;
            } else if (isToDefault && typeof t.to_category_name === "string") {
              toDisplayName = t.to_category_name;
            } else {
              toDisplayName = typeof t.to_account_name === "string" ? t.to_account_name : "(Unknown)";
            }

            // Parse payment_channel if present
            const paymentChannelRaw = t.payment_channel as Record<string, unknown> | undefined;
            
            // Get to_account from payment_channel if available
            const paymentChannelToAccount = paymentChannelRaw ? 
              (paymentChannelRaw['to_account'] as string | undefined) : undefined;
            
            // Use payment channel to_account for display if available
            const finalToDisplayName = paymentChannelToAccount || toDisplayName;

            return {
              id: thingIdToString(t.id) || "",
              fromAccountId: fromAccountId || "",
              toAccountId: toAccountId || undefined,
              fromAccountName: fromDisplayName,
              toAccountName: finalToDisplayName,
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
              updatedAt: typeof t.updated_at === "string" ? t.updated_at : undefined,
              createdBy: thingIdToString(t.created_by) || undefined,
              createdByName: typeof t.created_by_name === "string" ? t.created_by_name : undefined,
              externalTransactionId: typeof t.external_transaction_id === "string" ? t.external_transaction_id : undefined,
              tbTransferId: typeof t.tb_transfer_id === "string" ? t.tb_transfer_id : undefined,
              parentTransferId: thingIdToString(t.parent_transfer_id) || undefined,
              linkRole: typeof t.link_role === "string" ? t.link_role : undefined,
              paymentIntegrationLink: thingIdToString(t.payment_integration_link) || undefined,
              metadata: metadata,
              paymentChannel: paymentChannelRaw,
            };
          })
          .filter((t) => t.id);
      }
    }
  } catch {
    accountsData = { status: "skipped" as const, reason: "token_or_fetch_failed" };
  }

  const accounts = accountsData.status === "ok" ? accountsData.accounts : [];
  const externalAccountId = accountsData.status === "ok" ? accountsData.externalAccountId : undefined;

  return (
    <TransactionsClient
      accounts={accounts}
      categories={categoriesData}
      transfers={transfersData}
      initialCategoryId={categoryId || null}
      externalAccountId={externalAccountId}
    />
  );
}
