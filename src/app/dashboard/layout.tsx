import { auth0 } from "@/lib/auth0";
import { ensureUserExists } from "@/lib/userService";
import FloatingNav from "@/components/FloatingNav";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth0.getSession();

  if (!session?.user) {
    redirect("/");
  }

  // Server-side: ensure the user exists in your backend.
  try {
    const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
    const scope = process.env.AUTH0_SCOPE;

    const accessTokenOptions = {
      ...(audience ? { audience } : {}),
      ...(scope ? { scope } : {}),
    };

    const { token } = await auth0.getAccessToken(accessTokenOptions);
    await ensureUserExists({ accessToken: token, user: session.user });
  } catch {
    // Don't block rendering if the sync fails.
  }

  return (
    <div className="dashboard-shell">
      <FloatingNav />
      <main className="dashboard-main">{children}</main>
    </div>
  );
}
