import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import BudgetsClient from "@/components/BudgetsClient";
import { listCategoriesWithBudgets } from "@/lib/budgetService";

export const dynamic = "force-dynamic";

export default async function BudgetsPage() {
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

  let categories: Awaited<ReturnType<typeof listCategoriesWithBudgets>>;
  try {
    const { token } = await auth0.getAccessToken(accessTokenOptions);
    categories = await listCategoriesWithBudgets({ accessToken: token });
  } catch {
    categories = { status: "skipped", reason: "token_or_list_failed" };
  }

  return (
    <BudgetsClient
      categories={categories.status === "ok" ? categories.categories : []}
    />
  );
}
