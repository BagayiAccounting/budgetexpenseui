import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import BudgetTemplateDetailClient from "@/components/BudgetTemplateDetailClient";
import { getBudgetTemplateWithAllocations } from "@/lib/budgetService";

export const dynamic = "force-dynamic";

export default async function BudgetTemplateDetailPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId: encodedTemplateId } = await params;
  const templateId = decodeURIComponent(encodedTemplateId);
  
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

  let template: Awaited<ReturnType<typeof getBudgetTemplateWithAllocations>>;
  try {
    const { token } = await auth0.getAccessToken(accessTokenOptions);
    template = await getBudgetTemplateWithAllocations({ 
      accessToken: token,
      templateThingId: templateId 
    });
  } catch {
    template = { status: "skipped", reason: "token_or_fetch_failed" };
  }

  if (template.status === "skipped") {
    console.error("Failed to load budget template:", template.reason, "Template ID:", templateId);
    redirect("/dashboard/budgets");
  }

  return <BudgetTemplateDetailClient template={template.template} />;
}
