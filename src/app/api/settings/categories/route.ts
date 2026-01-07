import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { ensureUserExists } from "@/lib/userService";
import { createSubCategory } from "@/lib/settingsService";

export const dynamic = "force-dynamic";

function extractFirstResultId(payload: unknown): string | undefined {
  if (!Array.isArray(payload) || payload.length === 0) return undefined;
  const first = payload[0];
  if (!first || typeof first !== "object") return undefined;
  const result = (first as Record<string, unknown>).result;
  if (!Array.isArray(result) || result.length === 0) return undefined;
  const record = result[0];
  if (!record || typeof record !== "object") return undefined;
  const id = (record as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
}

export async function POST(req: Request) {
  console.log("[api] POST /api/settings/categories");

  const session = await auth0.getSession();
  if (!session?.user) {
    console.log("[api] unauthorized (no session)");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    console.log("[api] invalid_json");
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const parentCategoryId = body?.parentCategoryId;
  const name = body?.name;
  if (typeof parentCategoryId !== "string" || typeof name !== "string") {
    console.log("[api] invalid_payload", { parentCategoryIdType: typeof parentCategoryId, nameType: typeof name });
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
    console.log("[api] token_error");
    return NextResponse.json({ error: "token_error" }, { status: 500 });
  }

  const ensured = await ensureUserExists({ accessToken: token, user: session.user });
  if (ensured.status === "skipped") {
    console.log("[api] ensureUserExists skipped", ensured);
    return NextResponse.json(ensured, { status: 500 });
  }

  const userThingId = extractFirstResultId(ensured.user);
  if (!userThingId) {
    console.log("[api] could_not_extract_user_id");
    return NextResponse.json({ status: "skipped", reason: "could_not_extract_user_id" }, { status: 500 });
  }

  console.log("[api] createSubCategory request", { parentCategoryId, nameLength: name.length, userThingId });

  const result = await createSubCategory({
    accessToken: token,
    parentCategoryThingId: parentCategoryId,
    userThingId,
    name,
  });

  if (result.status !== "created") {
    console.log("[api] createSubCategory failed", result);
    const reason = (result as { reason?: unknown }).reason;
    const isClientError = typeof reason === "string" && (reason.startsWith("missing_") || reason.startsWith("invalid_"));
    return NextResponse.json(result, { status: isClientError ? 400 : 500 });
  }

  return NextResponse.json({ status: "created" });
}
