import { redirect } from "next/navigation";
import SetupCategories from "@/components/SetupCategories";
import { auth0 } from "@/lib/auth0";
import { hasAnyCategories } from "@/lib/budgetService";

export default async function SetupPage() {
  const session = await auth0.getSession();
  if (!session?.user) {
    redirect("/");
  }

  try {
    const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
    const scope = process.env.AUTH0_SCOPE;
    const accessTokenOptions = {
      ...(audience ? { audience } : {}),
      ...(scope ? { scope } : {}),
    };
    const { token } = await auth0.getAccessToken(accessTokenOptions);
    const setupRes = await hasAnyCategories({ accessToken: token, user: session.user });
    if (setupRes.status === "ok" && setupRes.hasAny) {
      redirect("/dashboard");
    }
  } catch {
    // If we can't determine, allow setup to render.
  }

  return <SetupCategories />;
}
