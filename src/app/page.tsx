import { auth0 } from "@/lib/auth0";
import LoginButton from "@/components/LoginButton";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth0.getSession();
  const user = session?.user;

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="app-container">
      <div className="main-card-wrapper">
        <img
          src="https://cdn.auth0.com/quantum-assets/dist/latest/logos/auth0/auth0-lockup-en-ondark.png"
          alt="Auth0 Logo"
          className="auth0-logo"
        />
        <h1 className="main-title">Next.js + Auth0</h1>
        
        <div className="action-card">
          <p className="action-text">
            Welcome! Please log in to access your dashboard.
          </p>
          <LoginButton />
        </div>
      </div>
    </div>
  );
}