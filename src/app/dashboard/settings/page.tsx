import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import SettingsClient from "@/components/SettingsClient";
import { listCategoriesWithAccounts } from "@/lib/settingsService";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth0.getSession();
  if (!session?.user) {
    redirect("/");
  }

  const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
  const scope = process.env.AUTH0_SCOPE;
  const accessTokenOptions = {
    ...(audience ? { audience } : {}),
    ...(scope ? { scope } : {}),
  };

  let categories: Awaited<ReturnType<typeof listCategoriesWithAccounts>>;
  try {
    const { token } = await auth0.getAccessToken(accessTokenOptions);
    categories = await listCategoriesWithAccounts({ accessToken: token });
  } catch {
    categories = { status: "skipped", reason: "token_or_list_failed" };
  }

  return (
    <SettingsClient
      categories={categories.status === "ok" ? categories.categories : []}
    />
  );
}
