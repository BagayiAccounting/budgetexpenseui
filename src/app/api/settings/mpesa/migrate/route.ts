import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import {
  executeSurrealQL,
  getResultArray,
  thingIdToString,
  toSurrealThingLiteral,
} from "@/lib/surrealdb";

type AccountRecord = {
  id: unknown;
  name?: unknown;
};

type IntegrationRecord = {
  id: unknown;
  category_id: unknown;
  utility_account: unknown;
  working_account: unknown;
  unlinked_transfer_in_account: unknown;
  unlinked_transfer_out_account: unknown;
  liability_account: unknown;
  b2c_paybill: unknown;
};

// POST: Check for conflicts and migrate M-Pesa integration to another category
export async function POST(request: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      integrationId,
      targetCategoryId,
      checkOnly, // If true, only check for conflicts without migrating
      accountRenames, // Optional: { [accountId]: newName } for renaming conflicting accounts
    } = body;

    if (!integrationId || !targetCategoryId) {
      return NextResponse.json(
        { error: "Missing required fields: integrationId, targetCategoryId" },
        { status: 400 }
      );
    }

    const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
    const scope = process.env.AUTH0_SCOPE;
    const { token } = await auth0.getAccessToken({
      ...(audience ? { audience } : {}),
      ...(scope ? { scope } : {}),
    });

    const integrationLiteral = toSurrealThingLiteral(integrationId);
    const targetCategoryLiteral = toSurrealThingLiteral(targetCategoryId);

    if (!integrationLiteral || !targetCategoryLiteral) {
      return NextResponse.json({ error: "Invalid IDs" }, { status: 400 });
    }

    // Get the integration with its linked accounts and b2c_paybill
    const getIntegrationQuery = `
      SELECT id, category_id, utility_account, working_account, unlinked_transfer_in_account, unlinked_transfer_out_account, liability_account, b2c_paybill
      FROM mpesa_paybill_integration
      WHERE id = ${integrationLiteral};
    `;

    const integrationResult = await executeSurrealQL({
      token,
      query: getIntegrationQuery,
      logName: "mpesa-migrate.POST (get integration)",
    });

    if (!integrationResult.success) {
      return NextResponse.json(
        { error: "Failed to fetch integration", details: integrationResult.error },
        { status: 500 }
      );
    }

    const integrations = getResultArray<IntegrationRecord>(integrationResult.data[0]);
    if (integrations.length === 0) {
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    }

    const integration = integrations[0];
    const currentCategoryId = thingIdToString(integration.category_id);

    if (currentCategoryId === targetCategoryId) {
      return NextResponse.json(
        { error: "Integration is already in the target category" },
        { status: 400 }
      );
    }

    // Get the linked account IDs from main integration
    const mainAccountIds = [
      thingIdToString(integration.utility_account),
      thingIdToString(integration.working_account),
      thingIdToString(integration.unlinked_transfer_in_account),
      thingIdToString(integration.unlinked_transfer_out_account),
      thingIdToString(integration.liability_account),
    ].filter(Boolean) as string[];

    // Check if there's a B2C paybill linked
    const b2cPaybillId = thingIdToString(integration.b2c_paybill);
    let b2cIntegration: IntegrationRecord | null = null;
    let b2cAccountIds: string[] = [];

    if (b2cPaybillId) {
      // Get the B2C integration and its accounts
      const b2cLiteral = toSurrealThingLiteral(b2cPaybillId);
      const getB2cQuery = `
        SELECT id, category_id, utility_account, working_account, unlinked_transfer_in_account, unlinked_transfer_out_account, liability_account
        FROM mpesa_paybill_integration
        WHERE id = ${b2cLiteral};
      `;

      const b2cResult = await executeSurrealQL({
        token,
        query: getB2cQuery,
        logName: "mpesa-migrate.POST (get b2c integration)",
      });

      if (b2cResult.success) {
        const b2cIntegrations = getResultArray<IntegrationRecord>(b2cResult.data[0]);
        if (b2cIntegrations.length > 0) {
          b2cIntegration = b2cIntegrations[0];
          b2cAccountIds = [
            thingIdToString(b2cIntegration.utility_account),
            thingIdToString(b2cIntegration.working_account),
            thingIdToString(b2cIntegration.unlinked_transfer_in_account),
            thingIdToString(b2cIntegration.unlinked_transfer_out_account),
            thingIdToString(b2cIntegration.liability_account),
          ].filter(Boolean) as string[];
        }
      }
    }

    // Combine all account IDs (main + b2c)
    const accountIds = [...mainAccountIds, ...b2cAccountIds];

    if (accountIds.length === 0) {
      return NextResponse.json(
        { error: "No linked accounts found for this integration" },
        { status: 400 }
      );
    }

    // Get the names of the accounts to be migrated
    const accountLiterals = accountIds.map((id) => toSurrealThingLiteral(id)).filter(Boolean);
    const getAccountNamesQuery = `
      SELECT id, name FROM account WHERE id IN [${accountLiterals.join(", ")}];
    `;

    const accountNamesResult = await executeSurrealQL({
      token,
      query: getAccountNamesQuery,
      logName: "mpesa-migrate.POST (get account names)",
    });

    if (!accountNamesResult.success) {
      return NextResponse.json(
        { error: "Failed to fetch account names", details: accountNamesResult.error },
        { status: 500 }
      );
    }

    const migratingAccounts = getResultArray<AccountRecord>(accountNamesResult.data[0]);
    const migratingAccountNames = migratingAccounts.map((a) => ({
      id: thingIdToString(a.id) || "",
      name: typeof a.name === "string" ? a.name : "",
    }));

    // Get existing account names in the target category
    const getTargetAccountsQuery = `
      SELECT id, name FROM account WHERE category_id = ${targetCategoryLiteral};
    `;

    const targetAccountsResult = await executeSurrealQL({
      token,
      query: getTargetAccountsQuery,
      logName: "mpesa-migrate.POST (get target accounts)",
    });

    if (!targetAccountsResult.success) {
      return NextResponse.json(
        { error: "Failed to fetch target category accounts", details: targetAccountsResult.error },
        { status: 500 }
      );
    }

    const targetAccounts = getResultArray<AccountRecord>(targetAccountsResult.data[0]);
    const existingNames = new Set(
      targetAccounts.map((a) => (typeof a.name === "string" ? a.name.toLowerCase() : ""))
    );

    // Check for conflicts (account names that already exist in target category)
    const conflicts: Array<{ id: string; currentName: string }> = [];
    for (const account of migratingAccountNames) {
      // Apply rename if provided
      const finalName = accountRenames?.[account.id] || account.name;
      if (existingNames.has(finalName.toLowerCase())) {
        conflicts.push({ id: account.id, currentName: account.name });
      }
    }

    // If checkOnly=true, just return the conflict information
    if (checkOnly) {
      return NextResponse.json({
        hasConflicts: conflicts.length > 0,
        conflicts,
        accounts: migratingAccountNames,
        hasB2cPaybill: !!b2cPaybillId,
        b2cAccountCount: b2cAccountIds.length,
      });
    }

    // If there are conflicts and no renames provided, return error
    if (conflicts.length > 0) {
      return NextResponse.json({
        error: "Account name conflicts detected",
        hasConflicts: true,
        conflicts,
        accounts: migratingAccountNames,
      }, { status: 409 });
    }

    // Perform the migration using the database function
    const updateQueries: string[] = [];

    // 1. First rename any accounts that have conflicts
    for (const account of migratingAccountNames) {
      const newName = accountRenames?.[account.id];
      if (newName) {
        const accountLiteral = toSurrealThingLiteral(account.id);
        updateQueries.push(`UPDATE ${accountLiteral} SET name = ${JSON.stringify(newName)};`);
      }
    }

    // 2. Use fn::move_gateway_category for the main integration
    updateQueries.push(`fn::move_gateway_category(${integrationLiteral}, ${targetCategoryLiteral});`);

    // 3. If there's a B2C integration, move it too
    if (b2cPaybillId) {
      const b2cLiteral = toSurrealThingLiteral(b2cPaybillId);
      updateQueries.push(`fn::move_gateway_category(${b2cLiteral}, ${targetCategoryLiteral});`);
    }

    const migrateResult = await executeSurrealQL({
      token,
      query: updateQueries.join("\n"),
      logName: "mpesa-migrate.POST (migrate)",
    });

    if (!migrateResult.success) {
      return NextResponse.json(
        { error: "Failed to migrate integration", details: migrateResult.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Integration migrated successfully",
      targetCategoryId,
    });
  } catch (error) {
    console.error("Error migrating M-Pesa integration:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}