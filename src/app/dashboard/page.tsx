import Link from "next/link";
export default async function DashboardPage() {
  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Overview</h1>
          <p className="dashboard-subtitle">Track your balance, spending, and activity.</p>
        </div>
        <div className="dashboard-header-actions">
          <Link className="button button-ghost" href="/dashboard/transactions">
            View transactions
          </Link>
        </div>
      </header>

      <section className="stats-grid">
        <div className="panel stat-card">
          <div className="stat-label">Total balance</div>
          <div className="stat-value">$12,480.00</div>
          <div className="stat-meta">Updated today</div>
        </div>
        <div className="panel stat-card">
          <div className="stat-label">Monthly spend</div>
          <div className="stat-value">$2,130.40</div>
          <div className="stat-meta">This month</div>
        </div>
        <div className="panel stat-card">
          <div className="stat-label">Savings</div>
          <div className="stat-value">$5,320.15</div>
          <div className="stat-meta">Goal in progress</div>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Spending breakdown</div>
              <div className="panel-subtitle">Category split (placeholder)</div>
            </div>
          </div>

          <div className="breakdown">
            <div className="donut" aria-hidden="true" />
            <div className="legend">
              <div className="legend-item"><span className="legend-dot dot-a" /> Housing</div>
              <div className="legend-item"><span className="legend-dot dot-b" /> Food</div>
              <div className="legend-item"><span className="legend-dot dot-c" /> Transport</div>
              <div className="legend-item"><span className="legend-dot dot-d" /> Subscriptions</div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Recent transactions</div>
              <div className="panel-subtitle">Latest activity (placeholder)</div>
            </div>
            <Link className="panel-link" href="/dashboard/transactions">
              See all
            </Link>
          </div>

          <div className="txn-list">
            <div className="txn-row">
              <div className="txn-left">
                <div className="txn-name">Grocery</div>
                <div className="txn-meta">Food • Today</div>
              </div>
              <div className="txn-amount negative">-$42.90</div>
            </div>
            <div className="txn-row">
              <div className="txn-left">
                <div className="txn-name">Salary</div>
                <div className="txn-meta">Income • Yesterday</div>
              </div>
              <div className="txn-amount positive">+$3,200.00</div>
            </div>
            <div className="txn-row">
              <div className="txn-left">
                <div className="txn-name">Streaming</div>
                <div className="txn-meta">Subscriptions • 2d ago</div>
              </div>
              <div className="txn-amount negative">-$12.99</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
