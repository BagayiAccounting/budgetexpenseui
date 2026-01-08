"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BudgetTemplateWithAllocations } from "@/lib/budgetService";

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatDate(dateString: string): string {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return dateString;
  }
}

type ModalType = "allocation" | "account" | null;

const ACCOUNT_TYPES = ["asset", "expense", "liability", "revenue", "equity"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

export default function BudgetTemplateDetailClient({ template }: { template: BudgetTemplateWithAllocations }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [modalType, setModalType] = useState<ModalType>(null);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [allocationAmount, setAllocationAmount] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("expense");
  const [isBusy, setIsBusy] = useState(false);

  const allocatedTotal = template.allocations.reduce((sum, alloc) => sum + alloc.amount, 0);
  const remaining = template.totalAmount - allocatedTotal;

  function openAllocationModal(accountId: string, currentAmount: number) {
    setModalType("allocation");
    setSelectedAccount(accountId);
    setAllocationAmount(currentAmount > 0 ? currentAmount.toString() : "");
    setError(null);
  }

  function openAccountModal() {
    setModalType("account");
    setAccountName("");
    setAccountType("expense");
    setError(null);
  }

  async function handleAddAllocation() {
    if (!selectedAccount || !allocationAmount) return;

    setError(null);
    setIsBusy(true);

    try {
      const res = await fetch("/api/budgets/allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budgetTemplateId: template.id,
          accountId: selectedAccount,
          amount: parseFloat(allocationAmount),
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && (data.reason || data.error)) || "Failed to create allocation");
        return;
      }

      setModalType(null);
      setSelectedAccount("");
      setAllocationAmount("");
      router.refresh();
    } catch {
      setError("Failed to create allocation");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleAddAccount() {
    if (!accountName.trim()) return;

    setError(null);
    setIsBusy(true);

    try {
      const res = await fetch("/api/settings/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: template.categoryId, name: accountName.trim(), type: accountType }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && (data.reason || data.error)) || "Failed to create account");
        return;
      }

      setModalType(null);
      setAccountName("");
      router.refresh();
    } catch {
      setError("Failed to create account");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <button
            type="button"
            onClick={() => router.push("/dashboard/budgets")}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "14px",
              marginBottom: "8px",
              padding: 0,
            }}
          >
            ← Back to Budgets
          </button>
          <h1 className="dashboard-title">{template.name}</h1>
          <p className="dashboard-subtitle">
            {template.categoryName} • Total: {formatNumber(template.totalAmount)} • Started: {formatDate(template.startAt)}
          </p>
        </div>
      </header>

      <div className="dashboard-grid">
        {/* Budget Summary */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Budget Summary</div>
          </div>
          <div style={{ padding: "20px" }}>
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                Total Budget
              </div>
              <div style={{ fontSize: "24px", fontWeight: 600 }}>{formatNumber(template.totalAmount)}</div>
            </div>
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                Allocated
              </div>
              <div style={{ fontSize: "24px", fontWeight: 600, color: allocatedTotal > 0 ? "#10b981" : undefined }}>
                {formatNumber(allocatedTotal)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "4px" }}>
                Remaining
              </div>
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: 600,
                  color: remaining < 0 ? "#ef4444" : remaining === 0 ? "#10b981" : undefined,
                }}
              >
                {formatNumber(remaining)}
              </div>
            </div>
          </div>
        </div>

        {/* Allocations */}
        <div className="panel">
          <div className="panel-header">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <div>
                <div className="panel-title">Budget Allocations</div>
                <div className="panel-subtitle">Click an account to allocate budget</div>
              </div>
              <button
                type="button"
                className="button button-ghost"
                onClick={openAccountModal}
                aria-label="Add account"
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
            </div>
          </div>

          <div className="txn-list">
            {template.accounts.length === 0 ? (
              <div className="txn-row">
                <div className="txn-left">
                  <div className="txn-name">No accounts available</div>
                  <div className="txn-meta">Click + to create an account</div>
                </div>
              </div>
            ) : (
              template.accounts.map((account) => {
                const allocation = template.allocations.find((a) => a.accountId === account.id);
                const amount = allocation ? allocation.amount : 0;
                const isAllocated = amount > 0;

                return (
                  <div 
                    key={account.id} 
                    className="txn-row" 
                    style={{ cursor: "pointer" }}
                    onClick={() => openAllocationModal(account.id, amount)}
                  >
                    <div className="txn-left">
                      <div className="txn-name">{account.name}</div>
                      <div className="txn-meta" style={{ color: isAllocated ? undefined : "var(--text-secondary)" }}>
                        {isAllocated ? `Allocated: ${formatNumber(amount)}` : "Click to allocate"}
                      </div>
                    </div>
                    <div className="txn-amount" style={{ color: isAllocated ? undefined : "var(--text-secondary)" }}>
                      {formatNumber(amount)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Modal for adding/editing allocation */}
      {modalType === "allocation" && (
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
          onClick={() => {
            setModalType(null);
            setError(null);
          }}
        >
          <div
            className="panel"
            style={{ width: "90%", maxWidth: "500px", margin: "20px", backgroundColor: "var(--bg-primary, #ffffff)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <div className="panel-title">Set Budget Allocation</div>
            </div>
            <div style={{ padding: "20px", backgroundColor: "var(--bg-primary, #ffffff)" }}>
              {error && (
                <div style={{ 
                  marginBottom: "16px", 
                  padding: "12px", 
                  backgroundColor: "#fee2e2", 
                  border: "1px solid #ef4444",
                  borderRadius: "8px",
                  color: "#991b1b"
                }}>
                  {error}
                </div>
              )}
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px" }}>Account</label>
                <select
                  className="setup-input"
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  disabled={isBusy}
                  style={{ width: "100%" }}
                >
                  {template.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px" }}>
                  Amount (Remaining: {formatNumber(remaining)})
                </label>
                <input
                  className="setup-input"
                  type="number"
                  step="0.01"
                  value={allocationAmount}
                  onChange={(e) => setAllocationAmount(e.target.value)}
                  placeholder="Enter amount"
                  disabled={isBusy}
                  style={{ width: "100%" }}
                  autoFocus
                />
              </div>
              <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => {
                    setModalType(null);
                    setError(null);
                  }}
                  disabled={isBusy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={handleAddAllocation}
                  disabled={isBusy || !selectedAccount || !allocationAmount}
                >
                  {isBusy ? "Saving…" : "Save Allocation"}
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
          onClick={() => {
            setModalType(null);
            setError(null);
          }}
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
              {error && (
                <div style={{ 
                  marginBottom: "16px", 
                  padding: "12px", 
                  backgroundColor: "#fee2e2", 
                  border: "1px solid #ef4444",
                  borderRadius: "8px",
                  color: "#991b1b"
                }}>
                  {error}
                </div>
              )}
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
                  style={{ width: "100%" }}
                  autoFocus
                />
              </div>
              <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => {
                    setModalType(null);
                    setError(null);
                  }}
                  disabled={isBusy}
                >
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
    </div>
  );
}
