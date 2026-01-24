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
      utilityAccountId,
      workingAccountId,
      unlinkedAccountId,
      createAccounts,
    } = body;

    if (!categoryId || !businessShortCode || !paybillName) {
      return NextResponse.json(
        { error: "Missing required fields: categoryId, businessShortCode, paybillName" },
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

    const query = `
      CREATE mpesa_paybill_integration CONTENT {
        business_short_code: ${JSON.stringify(businessShortCode)},
        paybill_name: ${JSON.stringify(paybillName)},
        category_id: ${categoryLiteral},
        utility_account: ${utilityAccountLiteral},
        working_account: ${workingAccountLiteral},
        unlinked_account: ${unlinkedAccountLiteral}
      };
    `;

    const result = await executeSurrealQL({
      token,
      query,
      logName: "mpesa.POST /api/settings/mpesa (create integration)",
    });

    if (!result.success) {
      return NextResponse.json(
        { error: "Failed to create M-Pesa integration", details: result.error },
        { status: 500 }
      );
    }

    const created = getResultArray<MpesaIntegrationRecord>(result.data[0]);
    if (!created.length) {
      return NextResponse.json(
        { error: "Integration created but no data returned" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      integration: {
        id: thingIdToString(created[0].id),
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
