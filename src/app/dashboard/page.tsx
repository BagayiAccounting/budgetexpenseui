import { auth0 } from "@/lib/auth0";
import LogoutButton from "@/components/LogoutButton";
import Profile from "@/components/Profile";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth0.getSession();

  if (!session?.user) {
    redirect("/");
  }

  return (
    <div className="app-container">
      <div className="main-card-wrapper">
        <h1 className="main-title">Dashboard</h1>
        <div className="action-card">
          <div className="logged-in-section">
            <p className="logged-in-message">✅ You’re logged in</p>
            <Profile />
            <LogoutButton />
          </div>
        </div>
      </div>
    </div>
  );
}
