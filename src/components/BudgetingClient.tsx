"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { TbAccount } from "@/lib/budgetingService";

const ACCOUNT_TYPES = ["asset", "expense", "liability", "revenue", "equity"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

type Category = {
  id: string;
  name: string;
  accounts: Array<{ id: string; name: string; tbAccount?: TbAccount }>;
  subcategories: Category[];
};

function signClass(value: number): string | undefined {
  return value < 0 ? "negative" : value > 0 ? "positive" : undefined;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function toFiniteNumber(value: string | number | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function rowsFromTbAccount(tbAccount: TbAccount | undefined): Array<{ label: string; text: string; className?: string }> {
  if (!tbAccount) return [];
  const rows: Array<{ label: string; text: string; className?: string }> = [];

  const book = toFiniteNumber(tbAccount.book_balance);
  const spendable = toFiniteNumber(tbAccount.spendable_balance);
  const projected = toFiniteNumber(tbAccount.projected_balance);

  if (book != null) rows.push({ label: "Book", text: formatNumber(book), className: signClass(book) });
  if (spendable != null) rows.push({ label: "Spendable", text: formatNumber(spendable), className: signClass(spendable) });
  if (projected != null) rows.push({ label: "Projected", text: formatNumber(projected), className: signClass(projected) });

  return rows;
}

export default function BudgetingClient({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [draftByCategory, setDraftByCategory] = useState<Record<string, string>>({});
  const [typeByCategory, setTypeByCategory] = useState<Record<string, AccountType>>({});
  const [subDraftByCategory, setSubDraftByCategory] = useState<Record<string, string>>({});
  const [busyCategory, setBusyCategory] = useState<string | null>(null);
  const [busySubCategory, setBusySubCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasAny = useMemo(() => categories.length > 0, [categories.length]);

  async function addAccount(categoryId: string) {
    setError(null);
    const name = (draftByCategory[categoryId] || "").trim();
    if (!name) return;

    const type = typeByCategory[categoryId] || "asset";

    setBusyCategory(categoryId);
    try {
      const res = await fetch("/api/budgeting/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, name, type }),
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

  async function addSubCategory(parentCategoryId: string) {
    setError(null);
    const name = (subDraftByCategory[parentCategoryId] || "").trim();
    if (!name) return;

    setBusySubCategory(parentCategoryId);
    try {
      const res = await fetch("/api/budgeting/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCategoryId, name }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && (data.reason || data.error)) || "Failed to create sub-category");
        return;
      }

      setSubDraftByCategory((prev) => ({ ...prev, [parentCategoryId]: "" }));
      router.refresh();
    } catch {
      setError("Failed to create sub-category");
    } finally {
      setBusySubCategory(null);
    }
  }

  function renderAccounts(accounts: Category["accounts"]) {
    if (accounts.length === 0) {
      return (
        <div className="txn-row">
          <div className="txn-left">
            <div className="txn-name">No accounts</div>
            <div className="txn-meta">Add one below</div>
          </div>
        </div>
      );
    }

    return accounts.map((a) => (
      <div key={a.id} className="txn-row">
        <div className="txn-left">
          <div className="txn-name">{a.name}</div>
          <div className="txn-meta">{a.id}</div>
        </div>
        {(() => {
          const rows = rowsFromTbAccount(a.tbAccount);
          if (!rows || rows.length === 0) return null;
          return (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
              {rows.map((row) => (
                <div key={row.label} className={`txn-meta${row.className ? ` ${row.className}` : ""}`}>
                  {row.label}: {row.text}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    ));
  }

  function renderAddAccountControls(categoryId: string) {
    return (
      <div className="setup-add" style={{ marginTop: 12 }}>
        <select
          className="setup-input"
          value={typeByCategory[categoryId] || "asset"}
          onChange={(e) => setTypeByCategory((prev) => ({ ...prev, [categoryId]: e.target.value as AccountType }))}
          disabled={busyCategory === categoryId}
          aria-label="Account type"
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          className="setup-input"
          value={draftByCategory[categoryId] || ""}
          onChange={(e) => setDraftByCategory((prev) => ({ ...prev, [categoryId]: e.target.value }))}
          placeholder="New account name"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void addAccount(categoryId);
            }
          }}
          disabled={busyCategory === categoryId}
        />
        <button
          type="button"
          className="button button-ghost"
          onClick={() => addAccount(categoryId)}
          disabled={busyCategory === categoryId || !(draftByCategory[categoryId] || "").trim()}
        >
          {busyCategory === categoryId ? "Adding…" : "Add account"}
        </button>
      </div>
    );
  }

  function renderCategoryBlock(cat: Category, depth: number) {
    const isSub = depth > 0;
    const containerStyle = isSub ? ({ marginTop: 12, marginLeft: 12 } as const) : ({ marginTop: 0 } as const);

    return (
      <div key={cat.id} style={containerStyle}>
        {isSub ? (
          <div className="txn-row">
            <div className="txn-left">
              <div className="txn-name">{cat.name}</div>
              <div className="txn-meta">Accounts: {cat.accounts.length}</div>
            </div>
          </div>
        ) : (
          <div className="panel-header">
            <div>
              <div className="panel-title">{cat.name}</div>
              <div className="panel-subtitle">Accounts: {cat.accounts.length}</div>
            </div>
          </div>
        )}

        <div className="txn-list">{renderAccounts(cat.accounts)}</div>

        {!isSub && (
          <div className="setup-add" style={{ marginTop: 12 }}>
            <input
              className="setup-input"
              value={subDraftByCategory[cat.id] || ""}
              onChange={(e) => setSubDraftByCategory((prev) => ({ ...prev, [cat.id]: e.target.value }))}
              placeholder="New sub-category name"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addSubCategory(cat.id);
                }
              }}
              disabled={busySubCategory === cat.id}
            />
            <button
              type="button"
              className="button button-ghost"
              onClick={() => addSubCategory(cat.id)}
              disabled={busySubCategory === cat.id || !(subDraftByCategory[cat.id] || "").trim()}
            >
              {busySubCategory === cat.id ? "Adding…" : "Add sub-category"}
            </button>
          </div>
        )}

        {renderAddAccountControls(cat.id)}

        {cat.subcategories.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="txn-meta">Sub-categories</div>
            {cat.subcategories.map((sub) => renderCategoryBlock(sub, depth + 1))}
          </div>
        )}
      </div>
    );
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
              {renderCategoryBlock(cat, 0)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
