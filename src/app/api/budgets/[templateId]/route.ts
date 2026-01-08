import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getBudgetTemplateWithAllocations } from "@/lib/budgetService";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const { templateId } = await params;
    
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

    const result = await getBudgetTemplateWithAllocations({
      accessToken: token,
      templateThingId: templateId,
    });

    if (result.status === "skipped") {
      return NextResponse.json({ error: "Failed to fetch template", reason: result.reason }, { status: 400 });
    }

    return NextResponse.json(result.template, { status: 200 });
  } catch (error) {
    console.error("Error fetching budget template:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
