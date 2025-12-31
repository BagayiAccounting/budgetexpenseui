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
      <div className="panel wide-card">
        <div className="dashboard-header">
          <div>
            <h1 className="dashboard-title">BudgetExpense</h1>
            <p className="dashboard-subtitle">
              Track spending, review transactions, and keep budgets under control.
            </p>
          </div>
        </div>

        <div className="dashboard-grid">
          <div className="panel">
            <div className="panel-title">What you get</div>
            <div className="panel-subtitle">A clean, fast personal finance workspace.</div>

            <div style={{ marginTop: "1rem" }} className="legend">
              <div className="legend-item">
                <span className="legend-dot dot-a" />
                Overview dashboard
              </div>
              <div className="legend-item">
                <span className="legend-dot dot-b" />
                Transactions view
              </div>
              <div className="legend-item">
                <span className="legend-dot dot-d" />
                Light & dark themes
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">Sign in</div>
            <div className="panel-subtitle">Secure authentication via Auth0.</div>

            <div style={{ marginTop: "1rem" }}>
              <LoginButton />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}