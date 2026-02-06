"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { TbAccount, AccountBalancesMap } from "@/lib/settingsService";
import { rowsFromTbAccount } from "@/lib/accountUtils";

const ACCOUNT_TYPES = ["asset", "expense", "liability", "revenue", "equity"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

type Category = {
  id: string;
  name: string;
  defaultAccountId?: string;
  accounts: Array<{ id: string; name: string; tbAccount?: TbAccount }>;
  subcategories: Category[];
};

type ModalType = "account" | "subcategory" | "category" | null;

export default function SettingsClient({ categories: initialCategories }: { categories: Category[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<AccountBalancesMap>({});
  const [balancesLoading, setBalancesLoading] = useState(true);
  const [modalType, setModalType] = useState<ModalType>(null);
  const [modalCategoryId, setModalCategoryId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState<string | null>(null);
  
  // Form states
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("asset");
  const [subcategoryName, setSubcategoryName] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  // Collect all account IDs from the category tree
  const collectAccountIds = useCallback((cats: Category[]): string[] => {
    const ids: string[] = [];
    function traverse(cat: Category) {
      for (const account of cat.accounts) {
        ids.push(account.id);
      }
      for (const sub of cat.subcategories) {
        traverse(sub);
      }
    }
    for (const cat of cats) {
      traverse(cat);
    }
    return ids;
  }, []);

  // Merge balances into categories
  const categories = useMemo(() => {
    function enrichCategory(cat: Category): Category {
      return {
        ...cat,
        accounts: cat.accounts.map((account) => {
          const tbAccount = balances[account.id] || balances[`account:${account.id.split(":")[1]}`];
          return {
            ...account,
            tbAccount: tbAccount || account.tbAccount,
          };
        }),
        subcategories: cat.subcategories.map(enrichCategory),
      };
    }
    return initialCategories.map(enrichCategory);
  }, [initialCategories, balances]);

  // Fetch balances asynchronously on mount
  useEffect(() => {
    const accountIds = collectAccountIds(initialCategories);
    if (accountIds.length === 0) {
      setBalancesLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchBalances() {
      try {
        const res = await fetch("/api/settings/balances", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountIds }),
        });

        if (!res.ok) {
          console.error("[SettingsClient] Failed to fetch balances:", res.status);
          return;
        }

        const data = await res.json();
        if (!cancelled && data.balances) {
          setBalances(data.balances);
        }
      } catch (err) {
        console.error("[SettingsClient] Error fetching balances:", err);
      } finally {
        if (!cancelled) {
          setBalancesLoading(false);
        }
      }
    }

    void fetchBalances();

    return () => {
      cancelled = true;
    };
  }, [initialCategories, collectAccountIds]);

  const hasAny = useMemo(() => categories.length > 0, [categories.length]);

  function openModal(type: ModalType, categoryId: string) {
    setModalType(type);
    setModalCategoryId(categoryId);
    setAccountName("");
    setAccountType("asset");
    setSubcategoryName("");
    setError(null);
    setShowDropdown(null);
  }

  function closeModal() {
    setModalType(null);
    setModalCategoryId(null);
    setAccountName("");
    setSubcategoryName("");
  }

  async function handleAddAccount() {
    if (!modalCategoryId || !accountName.trim()) return;
    
    setError(null);
    setIsBusy(true);

    try {
      const res = await fetch("/api/settings/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: modalCategoryId, name: accountName.trim(), type: accountType }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && (data.reason || data.error)) || "Failed to create account");
        return;
      }

      closeModal();
      router.refresh();
    } catch {
      setError("Failed to create account");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleAddSubCategory() {
    if (!modalCategoryId || !subcategoryName.trim()) return;
    
    setError(null);
    setIsBusy(true);

    try {
      const res = await fetch("/api/settings/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCategoryId: modalCategoryId, name: subcategoryName.trim() }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && (data.reason || data.error)) || "Failed to create sub-category");
        return;
      }

      closeModal();
      router.refresh();
    } catch {
      setError("Failed to create sub-category");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleAddCategory() {
    if (!subcategoryName.trim()) return;
    
    setError(null);
    setIsBusy(true);

    try {
      const res = await fetch("/api/settings/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: subcategoryName.trim() }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && (data.reason || data.error)) || "Failed to create category");
        return;
      }

      closeModal();
      router.refresh();
    } catch {
      setError("Failed to create category");
    } finally {
      setIsBusy(false);
    }
  }

  function getDefaultAccountBalance(cat: Category): string | null {
    // Return null to indicate loading state
    if (balancesLoading) return null;
    
    const defaultAccount = cat.accounts.find(a => a.id === cat.defaultAccountId);
    if (!defaultAccount?.tbAccount) return "-";
    
    const rows = rowsFromTbAccount(defaultAccount.tbAccount);
    const bookRow = rows.find(r => r.label === "Book");
    return bookRow ? bookRow.text : "-";
  }

  function countTotalSubcategories(cat: Category): number {
    let count = cat.subcategories.length;
    for (const sub of cat.subcategories) {
      count += countTotalSubcategories(sub);
    }
    return count;
  }

  function renderCategoryRow(cat: Category) {
    const balance = getDefaultAccountBalance(cat);
    const totalSubcategories = countTotalSubcategories(cat);

    return (
      <tr
        key={cat.id}
        style={{
          borderBottom: "1px solid var(--border)",
          cursor: "pointer",
        }}
        onClick={() => router.push(`/dashboard/settings/${cat.id}`)}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover, #f5f5f5)")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
      >
        <td style={{ padding: "16px", fontWeight: 500 }}>{cat.name}</td>
        <td style={{ padding: "16px", textAlign: "right", fontFamily: "monospace" }}>
          {balance === null ? (
            <span
              style={{
                display: "inline-block",
                width: "60px",
                height: "16px",
                backgroundColor: "var(--bg-hover, #e5e5e5)",
                borderRadius: "4px",
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
          ) : (
            balance
          )}
        </td>
        <td style={{ padding: "16px", textAlign: "center" }}>{cat.accounts.length}</td>
        <td style={{ padding: "16px", textAlign: "center" }}>{totalSubcategories}</td>
        <td style={{ padding: "16px", textAlign: "right" }}>
          <button
            type="button"
            className="button button-ghost"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/dashboard/settings/${cat.id}`);
            }}
            style={{ padding: "6px 12px", fontSize: "13px" }}
          >
            View →
          </button>
        </td>
      </tr>
    );
  }

  function renderAccounts(accounts: Category["accounts"], cat: Category) {
    if (accounts.length === 0) {
      return (
        <div className="txn-row">
          <div className="txn-left">
            <div className="txn-name">No accounts</div>
            <div className="txn-meta">Click + to add</div>
          </div>
        </div>
      );
    }

    return accounts.map((a) => {
      const isDefault = cat.defaultAccountId === a.id;
      return (
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
      );
    });
  }

  function renderCategoryBlock(cat: Category, depth: number) {
    const isSub = depth > 0;
    const containerStyle = isSub ? ({ marginTop: 12, marginLeft: 12 } as const) : ({ marginTop: 0 } as const);
    const isDropdownOpen = showDropdown === cat.id;

    return (
      <div key={cat.id} style={containerStyle}>
        {isSub ? (
          <div className="txn-row" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/settings/${cat.id}`)}>
            <div className="txn-left">
              <div className="txn-name">{cat.name}</div>
              <div className="txn-meta">Accounts: {cat.accounts.length}</div>
            </div>
            <button
              type="button"
              className="button button-ghost"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/dashboard/settings/${cat.id}`);
              }}
              aria-label={`Expand ${cat.name} category`}
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
        ) : (
          <div className="panel-header">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <div>
                <div className="panel-title">{cat.name}</div>
                <div className="panel-subtitle">Accounts: {cat.accounts.length}</div>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={() => setShowDropdown(isDropdownOpen ? null : cat.id)}
                    aria-label="Add item"
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
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                  </button>
                  {isDropdownOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "100%",
                        right: 0,
                        marginTop: "4px",
                        backgroundColor: "var(--bg-primary, #ffffff)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                        zIndex: 10,
                        minWidth: "160px",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => openModal("account", cat.id)}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "12px 16px",
                          textAlign: "left",
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          fontSize: "14px",
                          color: "#000000",
                          fontWeight: 500,
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover)")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        Add Account
                      </button>
                      <button
                        type="button"
                        onClick={() => openModal("subcategory", cat.id)}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "12px 16px",
                          textAlign: "left",
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          fontSize: "14px",
                          color: "#000000",
                          fontWeight: 500,
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover)")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        Add Sub-category
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => router.push(`/dashboard/settings/${cat.id}`)}
                  aria-label={`Expand ${cat.name} category`}
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
          </div>
        )}

        <div className="txn-list">{renderAccounts(cat.accounts, cat)}</div>

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>
          <div>
            <h1 className="dashboard-title">Settings</h1>
            <p className="dashboard-subtitle">Manage categories and their accounts.</p>
          </div>
          <button
            type="button"
            className="button"
            onClick={() => openModal("category", "")}
            style={{ padding: "8px 16px" }}
          >
            + New Category
          </button>
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
        <div className="panel">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  <th style={{ padding: "12px", textAlign: "left", fontWeight: 600, fontSize: "14px" }}>Name</th>
                  <th style={{ padding: "12px", textAlign: "right", fontWeight: 600, fontSize: "14px" }}>Balance</th>
                  <th style={{ padding: "12px", textAlign: "center", fontWeight: 600, fontSize: "14px" }}>Accounts</th>
                  <th style={{ padding: "12px", textAlign: "center", fontWeight: 600, fontSize: "14px" }}>Sub-categories</th>
                  <th style={{ padding: "12px", textAlign: "right", fontWeight: 600, fontSize: "14px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((cat) => renderCategoryRow(cat))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal for adding account */}
      {modalType === "account" && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={closeModal}
        >
          <div
            className="panel"
            style={{ width: "90%", maxWidth: "500px", margin: "20px", backgroundColor: "var(--bg-primary, #ffffff)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <div className="panel-title">Add Account</div>
            </div>
            <div style={{ padding: "20px", backgroundColor: "var(--bg-primary, #ffffff)" }}>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px" }}>Account Type</label>
                <select
                  className="setup-input"
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as AccountType)}
                  disabled={isBusy}
                  style={{ width: "100%" }}
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px" }}>Account Name</label>
                <input
                  className="setup-input"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="Enter account name"
                  disabled={isBusy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAddAccount();
                    }
                  }}
                  style={{ width: "100%" }}
                  autoFocus
                />
              </div>
              <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                <button type="button" className="button button-ghost" onClick={closeModal} disabled={isBusy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={handleAddAccount}
                  disabled={isBusy || !accountName.trim()}
                >
                  {isBusy ? "Adding…" : "Add Account"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal for adding sub-category */}
      {modalType === "subcategory" && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={closeModal}
        >
          <div
            className="panel"
            style={{ width: "90%", maxWidth: "500px", margin: "20px", backgroundColor: "var(--bg-primary, #ffffff)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <div className="panel-title">Add Sub-category</div>
            </div>
            <div style={{ padding: "20px", backgroundColor: "var(--bg-primary, #ffffff)" }}>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px" }}>Sub-category Name</label>
                <input
                  className="setup-input"
                  value={subcategoryName}
                  onChange={(e) => setSubcategoryName(e.target.value)}
                  placeholder="Enter sub-category name"
                  disabled={isBusy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAddSubCategory();
                    }
                  }}
                  style={{ width: "100%" }}
                  autoFocus
                />
              </div>
              <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                <button type="button" className="button button-ghost" onClick={closeModal} disabled={isBusy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={handleAddSubCategory}
                  disabled={isBusy || !subcategoryName.trim()}
                >
                  {isBusy ? "Adding…" : "Add Sub-category"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal for adding standalone category */}
      {modalType === "category" && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={closeModal}
        >
          <div
            className="panel"
            style={{ width: "90%", maxWidth: "500px", margin: "20px", backgroundColor: "var(--bg-primary, #ffffff)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <div className="panel-title">New Category</div>
            </div>
            <div style={{ padding: "20px", backgroundColor: "var(--bg-primary, #ffffff)" }}>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px" }}>Category Name</label>
                <input
                  className="setup-input"
                  value={subcategoryName}
                  onChange={(e) => setSubcategoryName(e.target.value)}
                  placeholder="Enter category name"
                  disabled={isBusy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAddCategory();
                    }
                  }}
                  style={{ width: "100%" }}
                  autoFocus
                />
              </div>
              <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                <button type="button" className="button button-ghost" onClick={closeModal} disabled={isBusy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={handleAddCategory}
                  disabled={isBusy || !subcategoryName.trim()}
                >
                  {isBusy ? "Creating…" : "Create Category"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
