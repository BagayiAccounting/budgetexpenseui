"use client";

import { useState } from "react";
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

export default function CategoryDetailClient({ category }: { category: Category }) {
  const router = useRouter();
  const [draftByCategory, setDraftByCategory] = useState<Record<string, string>>({});
  const [typeByCategory, setTypeByCategory] = useState<Record<string, AccountType>>({});
  const [subDraftByCategory, setSubDraftByCategory] = useState<Record<string, string>>({});
  const [busyCategory, setBusyCategory] = useState<string | null>(null);
  const [busySubCategory, setBusySubCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  function renderAccounts(accounts: Category["accounts"], categoryId: string) {
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

  function renderSubcategory(subcat: Category) {
    return (
      <div key={subcat.id} className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            <div>
              <div className="panel-title">{subcat.name}</div>
              <div className="panel-subtitle">Accounts: {subcat.accounts.length}</div>
            </div>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => router.push(`/dashboard/budgeting/${subcat.id}`)}
              aria-label={`Expand ${subcat.name} category`}
              style={{ padding: "8px 12px" }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>
        </div>

        <div className="txn-list">{renderAccounts(subcat.accounts, subcat.id)}</div>

        {renderAddAccountControls(subcat.id)}

        {subcat.subcategories.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="txn-meta">Nested Sub-categories</div>
            {subcat.subcategories.map((nestedSub) => renderSubcategory(nestedSub))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => router.push("/dashboard/budgeting")}
            style={{ marginBottom: 8, padding: "4px 8px" }}
          >
            ← Back to All Categories
          </button>
          <h1 className="dashboard-title">{category.name}</h1>
          <p className="dashboard-subtitle">
            Category details with {category.accounts.length} account{category.accounts.length !== 1 ? "s" : ""} and{" "}
            {category.subcategories.length} sub-categor{category.subcategories.length !== 1 ? "ies" : "y"}
          </p>
        </div>
      </header>

      {error && (
        <div className="panel error-state">
          <div className="panel-title">Something went wrong</div>
          <div className="panel-subtitle">{error}</div>
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Accounts</div>
            <div className="panel-subtitle">Direct accounts in this category</div>
          </div>
        </div>

        <div className="txn-list">{renderAccounts(category.accounts, category.id)}</div>

        <div className="setup-add" style={{ marginTop: 12 }}>
          <input
            className="setup-input"
            value={subDraftByCategory[category.id] || ""}
            onChange={(e) => setSubDraftByCategory((prev) => ({ ...prev, [category.id]: e.target.value }))}
            placeholder="New sub-category name"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addSubCategory(category.id);
              }
            }}
            disabled={busySubCategory === category.id}
          />
          <button
            type="button"
            className="button button-ghost"
            onClick={() => addSubCategory(category.id)}
            disabled={busySubCategory === category.id || !(subDraftByCategory[category.id] || "").trim()}
          >
            {busySubCategory === category.id ? "Adding…" : "Add sub-category"}
          </button>
        </div>

        {renderAddAccountControls(category.id)}
      </div>

      {category.subcategories.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 className="panel-title" style={{ marginBottom: 12 }}>
            Sub-categories
          </h2>
          {category.subcategories.map((subcat) => renderSubcategory(subcat))}
        </div>
      )}
    </div>
  );
}
