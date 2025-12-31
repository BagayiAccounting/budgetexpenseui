import { auth0 } from "@/lib/auth0";
import LogoutButton from "@/components/LogoutButton";
import Profile from "@/components/Profile";
import { redirect } from "next/navigation";
import { ensureUserExists } from "@/lib/userService";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth0.getSession();

  if (!session?.user) {
    redirect("/");
  }

  // Server-side: use an access token to ensure the user exists in your backend.
  // This avoids exposing the token to the browser.
  let syncStatus: string | null = null;
  let syncDetail: string | null = null;
  try {
    const audience = process.env.AUTH0_AUDIENCE || process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
    const scope = process.env.AUTH0_SCOPE;

    const accessTokenOptions = {
      ...(audience ? { audience } : {}),
      ...(scope ? { scope } : {}),
    };

    const { token } = await auth0.getAccessToken(accessTokenOptions);

    if (process.env.NODE_ENV !== "production" && process.env.DEBUG_LOG_ACCESS_TOKEN === "true") {
      console.log("[dashboard] access token (debug):", token);
    }

    const result = await ensureUserExists({ accessToken: token, user: session.user });
    syncStatus = result.status;
    syncDetail = result.status === "skipped" ? result.reason : null;

    if (process.env.NODE_ENV !== "production") {
      console.log("[dashboard] ensureUserExists:", result.status);
    }
  } catch (err) {
    syncStatus = "error";
    syncDetail = err instanceof Error ? err.message : "unknown_error";
    if (process.env.NODE_ENV !== "production") {
      console.error("[dashboard] ensureUserExists failed:", err);
    }
  }

  return (
    <div className="app-container">
      <div className="main-card-wrapper">
        <h1 className="main-title">Dashboard</h1>
        <div className="action-card">
          <div className="logged-in-section">
            <p className="logged-in-message">✅ You’re logged in</p>
            {process.env.NODE_ENV !== "production" && syncStatus && (
              <p className="action-text">
                User sync: {syncStatus}
                {syncDetail ? ` (${syncDetail})` : ""}
              </p>
            )}
            <Profile />
            <LogoutButton />
          </div>
        </div>
      </div>
    </div>
  );
}
