import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createBudget } from "@/lib/budgetService";

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
    const { templateId, totalAmount, startAt, endAt, status } = body;

    if (!templateId || !totalAmount || !startAt || !endAt) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const result = await createBudget({
      accessToken: token,
      templateThingId: templateId,
      totalAmount: Number(totalAmount),
      startAt,
      endAt,
      status: status || "active",
    });

    if (result.status === "skipped") {
      return NextResponse.json({ error: "Failed to create budget", reason: result.reason }, { status: 400 });
    }

    return NextResponse.json({ success: true, id: result.id }, { status: 201 });
  } catch (error) {
    console.error("Error creating budget:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
