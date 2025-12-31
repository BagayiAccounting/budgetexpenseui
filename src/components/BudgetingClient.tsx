"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Category = {
  id: string;
  name: string;
  accounts: Array<{ id: string; name: string }>;
};

export default function BudgetingClient({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [draftByCategory, setDraftByCategory] = useState<Record<string, string>>({});
  const [busyCategory, setBusyCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasAny = useMemo(() => categories.length > 0, [categories.length]);

  async function addAccount(categoryId: string) {
    setError(null);
    const name = (draftByCategory[categoryId] || "").trim();
    if (!name) return;

    setBusyCategory(categoryId);
    try {
      const res = await fetch("/api/budgeting/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, name }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && (data.reason || data.error)) || "Failed to create account");
        return;
      }

      setDraftByCategory((prev) => ({ ...prev, [categoryId]: "" }));
      router.refresh();
    } catch {
      setError("Failed to create account");
    } finally {
      setBusyCategory(null);
    }
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Budgeting</h1>
          <p className="dashboard-subtitle">Categories and their accounts.</p>
        </div>
      </header>

      {error && (
        <div className="panel error-state">
          <div className="panel-title">Something went wrong</div>
          <div className="panel-subtitle">{error}</div>
        </div>
      )}

      {!hasAny ? (
        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">No categories yet</div>
              <div className="panel-subtitle">Waiting for SurrealDB events to populate data.</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="dashboard-grid">
          {categories.map((cat) => (
            <div key={cat.id} className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">{cat.name}</div>
                  <div className="panel-subtitle">Accounts: {cat.accounts.length}</div>
                </div>
              </div>

              <div className="txn-list">
                {cat.accounts.length === 0 ? (
                  <div className="txn-row">
                    <div className="txn-left">
                      <div className="txn-name">No accounts</div>
                      <div className="txn-meta">Add one below</div>
                    </div>
                  </div>
                ) : (
                  cat.accounts.map((a) => (
                    <div key={a.id} className="txn-row">
                      <div className="txn-left">
                        <div className="txn-name">{a.name}</div>
                        <div className="txn-meta">{a.id}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="setup-add" style={{ marginTop: 12 }}>
                <input
                  className="setup-input"
                  value={draftByCategory[cat.id] || ""}
                  onChange={(e) => setDraftByCategory((prev) => ({ ...prev, [cat.id]: e.target.value }))}
                  placeholder="New account name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addAccount(cat.id);
                    }
                  }}
                  disabled={busyCategory === cat.id}
                />
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => addAccount(cat.id)}
                  disabled={busyCategory === cat.id || !(draftByCategory[cat.id] || "").trim()}
                >
                  {busyCategory === cat.id ? "Adding…" : "Add account"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
