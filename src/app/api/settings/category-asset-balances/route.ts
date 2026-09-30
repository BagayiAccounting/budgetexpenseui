import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { fetchCategoryAssetBalances } from "@/lib/settingsService";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const categoryId = new URL(req.url).searchParams.get("categoryId");
  if (!categoryId) {
    return NextResponse.json({ error: "missing_category_id" }, { status: 400 });
  }

  const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
  const scope = process.env.AUTH0_SCOPE;

  try {
    const { token } = await auth0.getAccessToken({
      ...(audience ? { audience } : {}),
      ...(scope ? { scope } : {}),
    });
    const result = await fetchCategoryAssetBalances({ accessToken: token, categoryId });

    if (result.status !== "ok") {
      return NextResponse.json({ error: result.reason }, { status: 500 });
    }

    return NextResponse.json({ assets: result.assets ?? null });
  } catch {
    return NextResponse.json({ error: "token_error" }, { status: 500 });
  }
}