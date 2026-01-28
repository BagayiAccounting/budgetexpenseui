import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import {
  executeSurrealQL,
  getResultArray,
  thingIdToString,
  toSurrealThingLiteral,
} from "@/lib/surrealdb";

type MpesaIntegrationRecord = {
  id: unknown;
  business_short_code?: unknown;
  paybill_name?: unknown;
  initiator_name?: unknown;
  security_credential?: unknown;
  category_id?: unknown;
  utility_account?: unknown;
  working_account?: unknown;
  unlinked_account?: unknown;
};

export async function GET(request: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const categoryId = searchParams.get("categoryId");

    if (!categoryId) {
      return NextResponse.json({ error: "Missing categoryId" }, { status: 400 });
    }

    const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
    const scope = process.env.AUTH0_SCOPE;
    const { token } = await auth0.getAccessToken({
      ...(audience ? { audience } : {}),
      ...(scope ? { scope } : {}),
    });

    const categoryLiteral = toSurrealThingLiteral(categoryId);
    if (!categoryLiteral) {
      return NextResponse.json({ error: "Invalid categoryId" }, { status: 400 });
    }

    const query = `SELECT * FROM mpesa_paybill_integration WHERE category_id = ${categoryLiteral};`;

    const result = await executeSurrealQL({
      token,
      query,
      logName: "mpesa.GET /api/settings/mpesa",
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    const integrations = getResultArray<MpesaIntegrationRecord>(result.data[0]);
    
    const formatted = integrations.map((integration) => ({
      id: thingIdToString(integration.id),
      businessShortCode: typeof integration.business_short_code === "string" ? integration.business_short_code : "",
      paybillName: typeof integration.paybill_name === "string" ? integration.paybill_name : "",
      initiatorName: typeof integration.initiator_name === "string" ? integration.initiator_name : "",
      hasSecurityCredential: typeof integration.security_credential === "string" && integration.security_credential.length > 0,
      categoryId: thingIdToString(integration.category_id),
      utilityAccount: thingIdToString(integration.utility_account),
      workingAccount: thingIdToString(integration.working_account),
      unlinkedAccount: thingIdToString(integration.unlinked_account),
    }));

    return NextResponse.json({ integrations: formatted });
  } catch (error) {
    console.error("Error fetching M-Pesa integration:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      categoryId,
      businessShortCode,
      paybillName,
      initiatorName,
      securityCredential,
      consumerKey,
      consumerSecret,
      utilityAccountId,
      workingAccountId,
      unlinkedAccountId,
      createAccounts,
    } = body;

    if (!categoryId || !businessShortCode || !paybillName || !initiatorName || !securityCredential || !consumerKey || !consumerSecret) {
      return NextResponse.json(
        { error: "Missing required fields: categoryId, businessShortCode, paybillName, initiatorName, securityCredential, consumerKey, consumerSecret" },
        { status: 400 }
      );
    }

    const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
    const scope = process.env.AUTH0_SCOPE;
    const { token } = await auth0.getAccessToken({
      ...(audience ? { audience } : {}),
      ...(scope ? { scope } : {}),
    });

    const categoryLiteral = toSurrealThingLiteral(categoryId);
    if (!categoryLiteral) {
      return NextResponse.json({ error: "Invalid categoryId" }, { status: 400 });
    }

    let utilityAccountLiteral: string;
    let workingAccountLiteral: string;
    let unlinkedAccountLiteral: string;

    // If createAccounts is true, create the three required accounts
    if (createAccounts) {
      const createAccountsQuery = `
        CREATE account CONTENT {
          name: "M-Pesa Utility",
          category_id: ${categoryLiteral},
          type: "asset"
        };
        CREATE account CONTENT {
          name: "M-Pesa Working",
          category_id: ${categoryLiteral},
          type: "asset"
        };
        CREATE account CONTENT {
          name: "M-Pesa Unlinked",
          category_id: ${categoryLiteral},
          type: "asset"
        };
      `;

      const accountsResult = await executeSurrealQL({
        token,
        query: createAccountsQuery,
        logName: "mpesa.POST /api/settings/mpesa (create accounts)",
      });

      if (!accountsResult.success) {
        return NextResponse.json(
          { error: "Failed to create accounts", details: accountsResult.error },
          { status: 500 }
        );
      }

      // Extract the three account records from the three CREATE statements
      const utilityAccount = getResultArray<{ id: unknown }>(accountsResult.data[0])[0];
      const workingAccount = getResultArray<{ id: unknown }>(accountsResult.data[1])[0];
      const unlinkedAccount = getResultArray<{ id: unknown }>(accountsResult.data[2])[0];

      if (!utilityAccount?.id || !workingAccount?.id || !unlinkedAccount?.id) {
        return NextResponse.json(
          { error: "Failed to retrieve created account IDs" },
          { status: 500 }
        );
      }

      const utilityId = thingIdToString(utilityAccount.id);
      const workingId = thingIdToString(workingAccount.id);
      const unlinkedId = thingIdToString(unlinkedAccount.id);

      if (!utilityId || !workingId || !unlinkedId) {
        return NextResponse.json(
          { error: "Failed to parse created account IDs" },
          { status: 500 }
        );
      }

      utilityAccountLiteral = toSurrealThingLiteral(utilityId) || "";
      workingAccountLiteral = toSurrealThingLiteral(workingId) || "";
      unlinkedAccountLiteral = toSurrealThingLiteral(unlinkedId) || "";
    } else {
      // Use provided account IDs
      if (!utilityAccountId || !workingAccountId || !unlinkedAccountId) {
        return NextResponse.json(
          { error: "Missing account IDs. Provide utilityAccountId, workingAccountId, and unlinkedAccountId" },
          { status: 400 }
        );
      }

      utilityAccountLiteral = toSurrealThingLiteral(utilityAccountId) || "";
      workingAccountLiteral = toSurrealThingLiteral(workingAccountId) || "";
      unlinkedAccountLiteral = toSurrealThingLiteral(unlinkedAccountId) || "";

      if (!utilityAccountLiteral || !workingAccountLiteral || !unlinkedAccountLiteral) {
        return NextResponse.json({ error: "Invalid account IDs" }, { status: 400 });
      }
    }

    // Check if integration already exists for this category
    const checkQuery = `SELECT * FROM mpesa_paybill_integration WHERE category_id = ${categoryLiteral};`;
    
    const checkResult = await executeSurrealQL({
      token,
      query: checkQuery,
      logName: "mpesa.POST /api/settings/mpesa (check existing)",
    });

    if (!checkResult.success) {
      return NextResponse.json(
        { error: "Failed to check existing integration", details: checkResult.error },
        { status: 500 }
      );
    }

    const existingIntegrations = getResultArray<MpesaIntegrationRecord>(checkResult.data[0]);
    const existingIntegration = existingIntegrations.length > 0 ? existingIntegrations[0] : null;

    let query: string;
    let logName: string;

    if (existingIntegration) {
      // UPDATE existing integration
      const existingId = thingIdToString(existingIntegration.id);
      if (!existingId) {
        return NextResponse.json(
          { error: "Failed to parse existing integration ID" },
          { status: 500 }
        );
      }
      const existingLiteral = toSurrealThingLiteral(existingId);
      
      query = `
        UPDATE ${existingLiteral} SET
          business_short_code = ${JSON.stringify(businessShortCode)},
          paybill_name = ${JSON.stringify(paybillName)},
          initiator_name = ${JSON.stringify(initiatorName)},
          security_credential = ${JSON.stringify(securityCredential)},
          consumer_key = ${JSON.stringify(consumerKey)},
          consumer_secret = ${JSON.stringify(consumerSecret)},
          utility_account = ${utilityAccountLiteral},
          working_account = ${workingAccountLiteral},
          unlinked_account = ${unlinkedAccountLiteral};
      `;
      logName = "mpesa.POST /api/settings/mpesa (update integration)";
    } else {
      // CREATE new integration
      query = `
        CREATE mpesa_paybill_integration CONTENT {
          business_short_code: ${JSON.stringify(businessShortCode)},
          paybill_name: ${JSON.stringify(paybillName)},
          initiator_name: ${JSON.stringify(initiatorName)},
          security_credential: ${JSON.stringify(securityCredential)},
          consumer_key: ${JSON.stringify(consumerKey)},
          consumer_secret: ${JSON.stringify(consumerSecret)},
          category_id: ${categoryLiteral},
          utility_account: ${utilityAccountLiteral},
          working_account: ${workingAccountLiteral},
          unlinked_account: ${unlinkedAccountLiteral}
        };
      `;
      logName = "mpesa.POST /api/settings/mpesa (create integration)";
    }

    const result = await executeSurrealQL({
      token,
      query,
      logName,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: existingIntegration ? "Failed to update M-Pesa integration" : "Failed to create M-Pesa integration", details: result.error },
        { status: 500 }
      );
    }

    const resultData = getResultArray<MpesaIntegrationRecord>(result.data[0]);
    if (!resultData.length) {
      return NextResponse.json(
        { error: "Integration operation completed but no data returned" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      integration: {
        id: thingIdToString(resultData[0].id),
        businessShortCode,
        paybillName,
        categoryId,
      },
    });
  } catch (error) {
    console.error("Error creating M-Pesa integration:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const integrationId = searchParams.get("id");

    if (!integrationId) {
      return NextResponse.json({ error: "Missing integration ID" }, { status: 400 });
    }

    const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
    const scope = process.env.AUTH0_SCOPE;
    const { token } = await auth0.getAccessToken({
      ...(audience ? { audience } : {}),
      ...(scope ? { scope } : {}),
    });

    const integrationLiteral = toSurrealThingLiteral(integrationId);
    if (!integrationLiteral) {
      return NextResponse.json({ error: "Invalid integration ID" }, { status: 400 });
    }

    const query = `DELETE ${integrationLiteral};`;

    const result = await executeSurrealQL({
      token,
      query,
      logName: "mpesa.DELETE /api/settings/mpesa",
    });

    if (!result.success) {
      return NextResponse.json(
        { error: "Failed to delete integration", details: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting M-Pesa integration:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
