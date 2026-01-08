"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BudgetTemplate, Budget } from "@/lib/budgetService";

type CategoryWithBudgets = {
  id: string;
  name: string;
  budgetTemplates: BudgetTemplate[];
  budgets: Budget[];
  subcategories: CategoryWithBudgets[];
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatDate(dateString: string): string {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return dateString;
  }
}

const ACCOUNT_TYPES = ["asset", "expense", "liability", "revenue", "equity"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

type ModalType = "template" | "budget" | "account" | "subcategory" | null;

export default function BudgetsClient({ categories }: { categories: CategoryWithBudgets[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [modalType, setModalType] = useState<ModalType>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState<string | null>(null);

  // Form states for budget template
  const [templateName, setTemplateName] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [startAt, setStartAt] = useState("");
  
  // Form states for budget
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetStartAt, setBudgetStartAt] = useState("");
  const [budgetEndAt, setBudgetEndAt] = useState("");
  
  // Form states for account
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("asset");
  
  // Form states for subcategory
  const [subcategoryName, setSubcategoryName] = useState("");
  
  const [isBusy, setIsBusy] = useState(false);

  const hasAny = useMemo(() => categories.length > 0, [categories.length]);

  function openTemplateModal(categoryId: string) {
    setModalType("template");
    setSelectedCategory(categoryId);
    setSelectedTemplate(null);
    setTemplateName("");
    setTotalAmount("");
    setStartAt("");
    setError(null);
    setShowDropdown(null);
  }

  function openBudgetModal(categoryId: string, templateId: string) {
    setModalType("budget");
    setSelectedCategory(categoryId);
    setSelectedTemplate(templateId);
    setBudgetAmount("");
    setBudgetStartAt("");
    setBudgetEndAt("");
    setError(null);
    setShowDropdown(null);
  }

  function openModal(type: ModalType, categoryId: string) {
    setModalType(type);
    setSelectedCategory(categoryId);
    setSelectedTemplate(null);
    setAccountName("");
    setAccountType("asset");
    setSubcategoryName("");
    setError(null);
    setShowDropdown(null);
  }

  function closeModal() {
    setModalType(null);
    setSelectedCategory(null);
    setSelectedTemplate(null);
    setTemplateName("");
    setTotalAmount("");
    setStartAt("");
    setBudgetAmount("");
    setBudgetStartAt("");
    setBudgetEndAt("");
    setAccountName("");
    setSubcategoryName("");
  }

  async function handleAddTemplate() {
    if (!selectedCategory || !templateName.trim() || !totalAmount || !startAt) return;

    setError(null);
    setIsBusy(true);

    try {
      const res = await fetch("/api/budgets/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: selectedCategory,
          name: templateName.trim(),
          totalAmount: parseFloat(totalAmount),
          startAt: new Date(startAt).toISOString(),
          status: "active",
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && (data.reason || data.error)) || "Failed to create budget template");
        return;
      }

      closeModal();
      router.refresh();
    } catch {
      setError("Failed to create budget template");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleAddBudget() {
    if (!selectedTemplate || !budgetAmount || !budgetStartAt || !budgetEndAt) return;

    setError(null);
    setIsBusy(true);

    try {
      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: selectedTemplate,
          totalAmount: parseFloat(budgetAmount),
          startAt: new Date(budgetStartAt).toISOString(),
          endAt: new Date(budgetEndAt).toISOString(),
          status: "active",
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && (data.reason || data.error)) || "Failed to create budget");
        return;
      }

      closeModal();
      router.refresh();
    } catch {
      setError("Failed to create budget");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleAddAccount() {
    if (!selectedCategory || !accountName.trim()) return;

    setError(null);
    setIsBusy(true);

    try {
      const res = await fetch("/api/settings/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: selectedCategory, name: accountName.trim(), type: accountType }),
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
    if (!selectedCategory || !subcategoryName.trim()) return;

    setError(null);
    setIsBusy(true);

    try {
      const res = await fetch("/api/settings/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCategoryId: selectedCategory, name: subcategoryName.trim() }),
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

  function renderBudgetTemplates(templates: BudgetTemplate[]) {
    if (templates.length === 0) {
      return (
        <div className="txn-row">
          <div className="txn-left">
            <div className="txn-name">No budget templates</div>
            <div className="txn-meta">Click + to add</div>
          </div>
        </div>
      );
    }

    return templates.map((t) => (
      <div key={t.id} className="txn-row" style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/budgets/${encodeURIComponent(t.id)}`)}>
        <div className="txn-left">
          <div className="txn-name">{t.name}</div>
          <div className="txn-meta">
            Amount: {formatNumber(t.totalAmount)} • Started: {formatDate(t.startAt)} • Status: {t.status}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="button button-ghost"
            onClick={(e) => {
              e.stopPropagation();
              openBudgetModal(t.categoryId, t.id);
            }}
            aria-label="Create budget from template"
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
          <button
            type="button"
            className="button button-ghost"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/dashboard/budgets/${t.id}`);
            }}
            aria-label="View budget template details"
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
    ));
  }

  function renderBudgets(budgets: Budget[]) {
    if (budgets.length === 0) {
      return null;
    }

    return (
      <div style={{ marginTop: 12 }}>
        <div className="txn-meta" style={{ marginBottom: 8 }}>Active Budgets</div>
        {budgets.map((b) => (
          <div key={b.id} className="txn-row">
            <div className="txn-left">
              <div className="txn-name">{formatNumber(b.totalAmount)}</div>
              <div className="txn-meta">
                {formatDate(b.startAt)} - {formatDate(b.endAt)} • {b.status}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderCategoryBlock(cat: CategoryWithBudgets, depth: number) {
    const isSub = depth > 0;
    const containerStyle = isSub ? ({ marginTop: 12, marginLeft: 12 } as const) : ({ marginTop: 0 } as const);
    const isDropdownOpen = showDropdown === cat.id;

    return (
      <div key={cat.id} style={containerStyle}>
        {isSub ? (
          <div className="txn-row">
            <div className="txn-left">
              <div className="txn-name">{cat.name}</div>
              <div className="txn-meta">Templates: {cat.budgetTemplates.length} • Budgets: {cat.budgets.length}</div>
            </div>
          </div>
        ) : (
          <div className="panel-header">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <div>
                <div className="panel-title">{cat.name}</div>
                <div className="panel-subtitle">
                  Templates: {cat.budgetTemplates.length} • Budgets: {cat.budgets.length}
                </div>
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
                        minWidth: "180px",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => openTemplateModal(cat.id)}
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
                        Add Budget Template
                      </button>
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
              </div>
            </div>
          </div>
        )}

        <div className="txn-list">
          {renderBudgetTemplates(cat.budgetTemplates)}
          {renderBudgets(cat.budgets)}
        </div>

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
          <h1 className="dashboard-title">Budgets</h1>
          <p className="dashboard-subtitle">Manage budget templates and budgets for your categories.</p>
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
              <div className="panel-subtitle">Create categories in Settings first.</div>
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

      {/* Modal for adding budget template */}
      {modalType === "template" && (
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
              <div className="panel-title">Add Budget Template</div>
            </div>
            <div style={{ padding: "20px", backgroundColor: "var(--bg-primary, #ffffff)" }}>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px" }}>Template Name</label>
                <input
                  className="setup-input"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Enter template name"
                  disabled={isBusy}
                  style={{ width: "100%" }}
                  autoFocus
                />
              </div>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px" }}>Total Amount</label>
                <input
                  className="setup-input"
                  type="number"
                  step="0.01"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  placeholder="Enter amount"
                  disabled={isBusy}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px" }}>Start Date</label>
                <input
                  className="setup-input"
                  type="date"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  disabled={isBusy}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                <button type="button" className="button button-ghost" onClick={closeModal} disabled={isBusy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={handleAddTemplate}
                  disabled={isBusy || !templateName.trim() || !totalAmount || !startAt}
                >
                  {isBusy ? "Creating…" : "Create Template"}
                </button>
              </div>
            </div>
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

      {/* Modal for adding budget */}
      {modalType === "budget" && (
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
              <div className="panel-title">Create Budget</div>
            </div>
            <div style={{ padding: "20px", backgroundColor: "var(--bg-primary, #ffffff)" }}>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px" }}>Total Amount</label>
                <input
                  className="setup-input"
                  type="number"
                  step="0.01"
                  value={budgetAmount}
                  onChange={(e) => setBudgetAmount(e.target.value)}
                  placeholder="Enter amount"
                  disabled={isBusy}
                  style={{ width: "100%" }}
                  autoFocus
                />
              </div>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px" }}>Start Date</label>
                <input
                  className="setup-input"
                  type="date"
                  value={budgetStartAt}
                  onChange={(e) => setBudgetStartAt(e.target.value)}
                  disabled={isBusy}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px" }}>End Date</label>
                <input
                  className="setup-input"
                  type="date"
                  value={budgetEndAt}
                  onChange={(e) => setBudgetEndAt(e.target.value)}
                  disabled={isBusy}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                <button type="button" className="button button-ghost" onClick={closeModal} disabled={isBusy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={handleAddBudget}
                  disabled={isBusy || !budgetAmount || !budgetStartAt || !budgetEndAt}
                >
                  {isBusy ? "Creating…" : "Create Budget"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
