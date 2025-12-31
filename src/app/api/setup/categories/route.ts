import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createCategories } from "@/lib/budgetService";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const categories = (payload as any)?.categories;
  if (!Array.isArray(categories) || categories.some((c) => typeof c !== "string")) {
    return NextResponse.json({ error: "invalid_categories" }, { status: 400 });
  }

  const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
  const scope = process.env.AUTH0_SCOPE;
  const accessTokenOptions = {
    ...(audience ? { audience } : {}),
    ...(scope ? { scope } : {}),
  };

  let token: string | undefined;
  try {
    const res = await auth0.getAccessToken(accessTokenOptions);
    token = res.token;
  } catch {
    return NextResponse.json({ error: "token_error" }, { status: 500 });
  }

  const result = await createCategories({
    accessToken: token,
    user: session.user,
    categories,
  });

  if (result.status !== "created") {
    return NextResponse.json(result, { status: 500 });
  }

  // Mark setup complete via cookie so server components can redirect.
  const response = NextResponse.json(result);
  response.cookies.set({
    name: "be_setup_done",
    value: "1",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });

  return response;
}
