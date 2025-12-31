import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createAccount } from "@/lib/budgetingService";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const categoryId = payload?.categoryId;
  const name = payload?.name;
  if (typeof categoryId !== "string" || typeof name !== "string") {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
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

  const result = await createAccount({ accessToken: token, categoryThingId: categoryId, name });
  if (result.status !== "created") {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json({ status: "created" });
}
