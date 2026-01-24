import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import {
  executeSurrealQL,
  getResultArray,
  thingIdToString,
  toSurrealThingLiteral,
} from "@/lib/surrealdb";

type LinkRecord = {
  id: unknown;
  category_id?: unknown;
  mpesa_paybill_integration_id?: unknown;
};

type MpesaIntegrationRecord = {
  id: unknown;
  business_short_code?: unknown;
  paybill_name?: unknown;
};

// GET - Get link for a category or list all available M-Pesa integrations
export async function GET(request: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const categoryId = searchParams.get("categoryId");
    const listIntegrations = searchParams.get("listIntegrations") === "true";

    const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
    const scope = process.env.AUTH0_SCOPE;
    const { token } = await auth0.getAccessToken({
      ...(audience ? { audience } : {}),
      ...(scope ? { scope } : {}),
    });

    // List all available M-Pesa integrations
    if (listIntegrations) {
      const query = "SELECT * FROM mpesa_paybill_integration;";
      
      const result = await executeSurrealQL({
        token,
        query,
        logName: "category-mpesa-link.GET /api/settings/category-mpesa-link (list integrations)",
      });

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      const integrations = getResultArray<MpesaIntegrationRecord>(result.data[0]);
      
      const formatted = integrations.map((integration) => ({
        id: thingIdToString(integration.id),
        businessShortCode: typeof integration.business_short_code === "string" ? integration.business_short_code : "",
        paybillName: typeof integration.paybill_name === "string" ? integration.paybill_name : "",
      }));

      return NextResponse.json({ integrations: formatted });
    }

    // Get link for specific category
    if (!categoryId) {
      return NextResponse.json({ error: "Missing categoryId" }, { status: 400 });
    }

    const categoryLiteral = toSurrealThingLiteral(categoryId);
    if (!categoryLiteral) {
      return NextResponse.json({ error: "Invalid categoryId" }, { status: 400 });
    }

    const query = `SELECT * FROM category_payment_integration_link WHERE category_id = ${categoryLiteral};`;

    const result = await executeSurrealQL({
      token,
      query,
      logName: "category-mpesa-link.GET /api/settings/category-mpesa-link",
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    const links = getResultArray<LinkRecord>(result.data[0]);
    
    const formatted = links.map((link) => ({
      id: thingIdToString(link.id),
      categoryId: thingIdToString(link.category_id),
      mpesaIntegrationId: thingIdToString(link.mpesa_paybill_integration_id),
    }));

    return NextResponse.json({ links: formatted });
  } catch (error) {
    console.error("Error fetching category-mpesa link:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST - Create a link between category and M-Pesa integration
export async function POST(request: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { categoryId, mpesaIntegrationId, linkId } = body;

    if (!categoryId || !mpesaIntegrationId || !linkId) {
      return NextResponse.json(
        { error: "Missing required fields: categoryId, mpesaIntegrationId, linkId" },
        { status: 400 }
      );
    }

    // Validate linkId format: alphanumeric, max 13 characters
    const linkIdStr = String(linkId).trim();
    if (!/^[a-zA-Z0-9]+$/.test(linkIdStr)) {
      return NextResponse.json(
        { error: "Link ID must be alphanumeric only" },
        { status: 400 }
      );
    }

    if (linkIdStr.length > 13) {
      return NextResponse.json(
        { error: "Link ID must not exceed 13 characters" },
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
    const mpesaLiteral = toSurrealThingLiteral(mpesaIntegrationId);

    if (!categoryLiteral || !mpesaLiteral) {
      return NextResponse.json({ error: "Invalid IDs" }, { status: 400 });
    }

    // Check if link_id already exists
    const checkQuery = `SELECT * FROM category_payment_integration_link WHERE link_id = ${JSON.stringify(linkIdStr)};`;
    
    const checkResult = await executeSurrealQL({
      token,
      query: checkQuery,
      logName: "category-mpesa-link.POST /api/settings/category-mpesa-link (check link_id)",
    });

    if (checkResult.success) {
      const existing = getResultArray<LinkRecord>(checkResult.data[0]);
      if (existing.length > 0) {
        return NextResponse.json(
          { error: "Link ID already exists. Please choose a different one." },
          { status: 400 }
        );
      }
    }
    
    const query = `
      RELATE ${categoryLiteral}->category_payment_integration_link->${mpesaLiteral} CONTENT {
        link_id: ${JSON.stringify(linkIdStr)}
      };
    `;

    const result = await executeSurrealQL({
      token,
      query,
      logName: "category-mpesa-link.POST /api/settings/category-mpesa-link",
    });

    if (!result.success) {
      return NextResponse.json(
        { error: "Failed to create link", details: result.error },
        { status: 500 }
      );
    }

    const created = getResultArray<LinkRecord>(result.data[0]);
    if (!created.length) {
      return NextResponse.json(
        { error: "Link created but no data returned" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      link: {
        id: thingIdToString(created[0].id),
        categoryId,
        mpesaIntegrationId,
      },
    });
  } catch (error) {
    console.error("Error creating category-mpesa link:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE - Remove link between category and M-Pesa integration
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const linkId = searchParams.get("id");
    const categoryId = searchParams.get("categoryId");

    const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
    const scope = process.env.AUTH0_SCOPE;
    const { token } = await auth0.getAccessToken({
      ...(audience ? { audience } : {}),
      ...(scope ? { scope } : {}),
    });

    let query: string;

    if (linkId) {
      const linkLiteral = toSurrealThingLiteral(linkId);
      if (!linkLiteral) {
        return NextResponse.json({ error: "Invalid link ID" }, { status: 400 });
      }
      query = `DELETE ${linkLiteral};`;
    } else if (categoryId) {
      const categoryLiteral = toSurrealThingLiteral(categoryId);
      if (!categoryLiteral) {
        return NextResponse.json({ error: "Invalid category ID" }, { status: 400 });
      }
      query = `DELETE category_payment_integration_link WHERE category_id = ${categoryLiteral};`;
    } else {
      return NextResponse.json({ error: "Missing link ID or category ID" }, { status: 400 });
    }

    const result = await executeSurrealQL({
      token,
      query,
      logName: "category-mpesa-link.DELETE /api/settings/category-mpesa-link",
    });

    if (!result.success) {
      return NextResponse.json(
        { error: "Failed to delete link", details: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting category-mpesa link:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
