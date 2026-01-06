import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import CategoryDetailClient from "@/components/CategoryDetailClient";
import { listCategoriesWithAccounts } from "@/lib/budgetingService";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ categoryId: string }>;
};

export default async function CategoryDetailPage({ params }: PageProps) {
  const session = await auth0.getSession();
  if (!session?.user) {
    redirect("/");
  }

  const { categoryId } = await params;
  
  // Decode the categoryId in case it's URL encoded (e.g., category%3Asomeid -> category:someid)
  const decodedCategoryId = decodeURIComponent(categoryId);

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

  const allCategories = categories.status === "ok" ? categories.categories : [];
  
  // Find the category by ID (could be a root category or subcategory)
  function findCategoryById(cats: typeof allCategories, id: string): typeof allCategories[0] | null {
    for (const cat of cats) {
      if (cat.id === id) return cat;
      const found = findCategoryById(cat.subcategories, id);
      if (found) return found;
    }
    return null;
  }

  const category = findCategoryById(allCategories, decodedCategoryId);

  if (!category) {
    // Debug: Log what we're looking for vs what we have
    console.error(`Category not found. Looking for: "${decodedCategoryId}"`);
    console.error(`Available categories:`, allCategories.map(c => ({ id: c.id, name: c.name })));
    redirect("/dashboard/budgeting");
  }

  return <CategoryDetailClient category={category} />;
}
