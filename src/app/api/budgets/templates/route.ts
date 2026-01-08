import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createBudgetTemplate } from "@/lib/budgetService";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
    const scope = process.env.AUTH0_SCOPE;
    const accessTokenOptions = {
      ...(audience ? { audience } : {}),
      ...(scope ? { scope } : {}),
    };

    const { token } = await auth0.getAccessToken(accessTokenOptions);

    const body = await request.json();
    const { categoryId, name, totalAmount, startAt, status } = body;

    if (!categoryId || !name || !totalAmount || !startAt) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const result = await createBudgetTemplate({
      accessToken: token,
      categoryThingId: categoryId,
      name,
      totalAmount: Number(totalAmount),
      startAt,
      status: status || "active",
    });

    if (result.status === "skipped") {
      return NextResponse.json({ error: "Failed to create budget template", reason: result.reason }, { status: 400 });
    }

    return NextResponse.json({ success: true, id: result.id }, { status: 201 });
  } catch (error) {
    console.error("Error creating budget template:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
