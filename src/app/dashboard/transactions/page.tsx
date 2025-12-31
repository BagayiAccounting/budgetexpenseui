import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";

export default async function TransactionsPage() {
  const session = await auth0.getSession();
  if (!session?.user) {
    redirect("/");
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Transactions</h1>
          <p className="dashboard-subtitle">A simple view of your latest activity.</p>
        </div>
      </header>

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Latest</div>
            <div className="panel-subtitle">Placeholder rows</div>
          </div>
        </div>

        <div className="table">
          <div className="table-head">
            <div>Date</div>
            <div>Description</div>
            <div>Category</div>
            <div className="table-amount">Amount</div>
          </div>

          <div className="table-row">
            <div className="table-muted">Today</div>
            <div>Grocery</div>
            <div className="table-muted">Food</div>
            <div className="table-amount negative">-$42.90</div>
          </div>
          <div className="table-row">
            <div className="table-muted">Yesterday</div>
            <div>Salary</div>
            <div className="table-muted">Income</div>
            <div className="table-amount positive">+$3,200.00</div>
          </div>
          <div className="table-row">
            <div className="table-muted">2d ago</div>
            <div>Streaming</div>
            <div className="table-muted">Subscriptions</div>
            <div className="table-amount negative">-$12.99</div>
          </div>
        </div>
      </div>
    </div>
  );
}
