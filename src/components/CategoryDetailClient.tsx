"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { TbAccount } from "@/lib/settingsService";

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

type ModalType = "account" | "subcategory" | "mpesa" | null;

type MpesaIntegration = {
  id: string;
  businessShortCode: string;
  paybillName: string;
  utilityAccount: string;
  workingAccount: string;
  unlinkedAccount: string;
};

export default function CategoryDetailClient({ category }: { category: Category }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [modalType, setModalType] = useState<ModalType>(null);
  const [modalCategoryId, setModalCategoryId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState<string | null>(null);
  
  // Form states
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("asset");
  const [subcategoryName, setSubcategoryName] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  
  // M-Pesa integration states
  const [mpesaIntegration, setMpesaIntegration] = useState<MpesaIntegration | null>(null);
  const [loadingMpesa, setLoadingMpesa] = useState(false);
  const [businessShortCode, setBusinessShortCode] = useState("");
  const [paybillName, setPaybillName] = useState("");
  const [shouldCreateAccounts, setShouldCreateAccounts] = useState(true);
  const [utilityAccountId, setUtilityAccountId] = useState("");
  const [workingAccountId, setWorkingAccountId] = useState("");
  const [unlinkedAccountId, setUnlinkedAccountId] = useState("");

  // Function to load M-Pesa integration
  const loadMpesaIntegration = async () => {
    setLoadingMpesa(true);
    try {
      const res = await fetch(`/api/settings/mpesa?categoryId=${encodeURIComponent(category.id)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.integrations && data.integrations.length > 0) {
          setMpesaIntegration(data.integrations[0]);
        } else {
          setMpesaIntegration(null);
        }
      }
    } catch (err) {
      console.error("Failed to load M-Pesa integration:", err);
    } finally {
      setLoadingMpesa(false);
    }
  };

  // Load M-Pesa integration on mount
  useEffect(() => {
    void loadMpesaIntegration();
  }, [category.id]);

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

  function renderAccounts(accounts: Category["accounts"], categoryId: string) {
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

  function renderSubcategory(subcat: Category) {
    const isDropdownOpen = showDropdown === subcat.id;
    
    return (
      <div key={subcat.id} className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            <div>
              <div className="panel-title">{subcat.name}</div>
              <div className="panel-subtitle">Accounts: {subcat.accounts.length}</div>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => setShowDropdown(isDropdownOpen ? null : subcat.id)}
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
                      onClick={() => openModal("account", subcat.id)}
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
                      onClick={() => openModal("subcategory", subcat.id)}
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
                onClick={() => router.push(`/dashboard/settings/${subcat.id}`)}
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
        </div>

        <div className="txn-list">{renderAccounts(subcat.accounts, subcat.id)}</div>

        {subcat.subcategories.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="txn-meta">Nested Sub-categories</div>
            {subcat.subcategories.map((nestedSub) => renderSubcategory(nestedSub))}
          </div>
        )}
      </div>
    );
  }

  const isMainDropdownOpen = showDropdown === category.id;

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => router.push("/dashboard/settings")}
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

      {/* M-Pesa Integration Section */}
      <div className="panel">
        <div className="panel-header">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            <div>
              <div className="panel-title">M-Pesa Integration</div>
              <div className="panel-subtitle">Configure M-Pesa paybill for this category</div>
            </div>
            <button
              type="button"
              className="button"
              onClick={() => openModal("mpesa", category.id)}
              style={{ padding: "8px 16px" }}
            >
              {mpesaIntegration ? "Update Config" : "Add M-Pesa Config"}
            </button>
          </div>
        </div>
        {loadingMpesa ? (
          <div className="txn-row">
            <div className="txn-left">
              <div className="txn-meta">Loading M-Pesa configuration...</div>
            </div>
          </div>
        ) : mpesaIntegration ? (
          <div className="txn-list">
            <div className="txn-row">
              <div className="txn-left">
                <div className="txn-name">{mpesaIntegration.paybillName}</div>
                <div className="txn-meta">Business Short Code: {mpesaIntegration.businessShortCode}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="txn-row">
            <div className="txn-left">
              <div className="txn-meta">No M-Pesa configuration set up yet</div>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            <div>
              <div className="panel-title">Accounts</div>
              <div className="panel-subtitle">Direct accounts in this category</div>
            </div>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="button button-ghost"
                onClick={() => setShowDropdown(isMainDropdownOpen ? null : category.id)}
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
              {isMainDropdownOpen && (
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
                    onClick={() => openModal("account", category.id)}
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
                    onClick={() => openModal("subcategory", category.id)}
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
          </div>
        </div>

        <div className="txn-list">{renderAccounts(category.accounts, category.id)}</div>
      </div>

      {category.subcategories.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 className="panel-title" style={{ marginBottom: 12 }}>
            Sub-categories
          </h2>
          {category.subcategories.map((subcat) => renderSubcategory(subcat))}
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

      {/* Modal for M-Pesa Configuration */}
      {modalType === "mpesa" && (
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
            overflowY: "auto",
          }}
          onClick={closeModal}
        >
          <div
            className="panel"
            style={{ width: "90%", maxWidth: "600px", margin: "20px", backgroundColor: "var(--bg-primary, #ffffff)", maxHeight: "90vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <div className="panel-title">Configure M-Pesa Integration</div>
            </div>
            <div style={{ padding: "20px", backgroundColor: "var(--bg-primary, #ffffff)" }}>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  Paybill Name
                </label>
                <input
                  className="setup-input"
                  value={paybillName}
                  onChange={(e) => setPaybillName(e.target.value)}
                  placeholder="e.g., My Business Paybill"
                  disabled={isBusy}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  Business Short Code
                </label>
                <input
                  className="setup-input"
                  value={businessShortCode}
                  onChange={(e) => setBusinessShortCode(e.target.value)}
                  placeholder="e.g., 123456"
                  disabled={isBusy}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ marginBottom: "20px", padding: "16px", backgroundColor: "var(--bg-secondary, #f5f5f5)", borderRadius: "8px" }}>
                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={shouldCreateAccounts}
                      onChange={(e) => setShouldCreateAccounts(e.target.checked)}
                      disabled={isBusy}
                      style={{ marginRight: "8px" }}
                    />
                    <span style={{ fontSize: "14px", fontWeight: 500 }}>
                      Automatically create M-Pesa accounts
                    </span>
                  </label>
                  <div style={{ marginTop: "4px", marginLeft: "24px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                    Creates three accounts: Utility, Working, and Unlinked
                  </div>
                </div>
              </div>

              {!shouldCreateAccounts && (
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ marginBottom: "12px", padding: "12px", backgroundColor: "var(--bg-info, #e3f2fd)", borderRadius: "8px", fontSize: "13px" }}>
                    Select existing accounts for M-Pesa integration. All three accounts are required.
                  </div>

                  <div style={{ marginBottom: "12px" }}>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                      Utility Account
                    </label>
                    <select
                      className="setup-input"
                      value={utilityAccountId}
                      onChange={(e) => setUtilityAccountId(e.target.value)}
                      disabled={isBusy}
                      style={{ width: "100%" }}
                    >
                      <option value="">Select an account</option>
                      {category.accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ marginBottom: "12px" }}>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                      Working Account
                    </label>
                    <select
                      className="setup-input"
                      value={workingAccountId}
                      onChange={(e) => setWorkingAccountId(e.target.value)}
                      disabled={isBusy}
                      style={{ width: "100%" }}
                    >
                      <option value="">Select an account</option>
                      {category.accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ marginBottom: "12px" }}>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                      Unlinked Account
                    </label>
                    <select
                      className="setup-input"
                      value={unlinkedAccountId}
                      onChange={(e) => setUnlinkedAccountId(e.target.value)}
                      disabled={isBusy}
                      style={{ width: "100%" }}
                    >
                      <option value="">Select an account</option>
                      {category.accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {error && (
                <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "var(--bg-error, #ffebee)", borderRadius: "8px", fontSize: "14px", color: "var(--text-error, #c62828)" }}>
                  {error}
                </div>
              )}

              <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                <button type="button" className="button button-ghost" onClick={closeModal} disabled={isBusy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={async () => {
                    if (!modalCategoryId || !businessShortCode.trim() || !paybillName.trim()) {
                      setError("Please fill in all required fields");
                      return;
                    }

                    if (!shouldCreateAccounts && (!utilityAccountId || !workingAccountId || !unlinkedAccountId)) {
                      setError("Please select all three accounts");
                      return;
                    }

                    setError(null);
                    setIsBusy(true);

                    try {
                      const body = {
                        categoryId: modalCategoryId,
                        businessShortCode: businessShortCode.trim(),
                        paybillName: paybillName.trim(),
                        createAccounts: shouldCreateAccounts,
                        ...(shouldCreateAccounts ? {} : {
                          utilityAccountId,
                          workingAccountId,
                          unlinkedAccountId,
                        }),
                      };

                      const res = await fetch("/api/settings/mpesa", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                      });

                      const data = await res.json().catch(() => null);
                      if (!res.ok) {
                        setError((data && (data.error || data.details)) || "Failed to configure M-Pesa integration");
                        return;
                      }

                      closeModal();
                      // Reload M-Pesa integration immediately
                      await loadMpesaIntegration();
                      router.refresh();
                    } catch {
                      setError("Failed to configure M-Pesa integration");
                    } finally {
                      setIsBusy(false);
                    }
                  }}
                  disabled={isBusy || !businessShortCode.trim() || !paybillName.trim()}
                >
                  {isBusy ? "Configuring…" : "Configure M-Pesa"}
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
    </div>
  );
}
