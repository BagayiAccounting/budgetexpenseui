"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Account = {
  id: string;
  name: string;
  categoryName: string;
  categoryId: string;
  balance?: string;
};

type Category = {
  id: string;
  name: string;
};

type Transfer = {
  id: string;
  fromAccountName: string;
  toAccountName: string;
  amount: number;
  type: string;
  status: string;
  label?: string;
  description?: string;
  createdAt: string;
};

const TRANSFER_TYPES = ["payment", "fees", "refund", "adjustment"] as const;
type TransferType = (typeof TRANSFER_TYPES)[number];

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatBalance(balance?: string): string {
  if (!balance) return "";
  try {
    const num = parseFloat(balance);
    if (isNaN(num)) return "";
    return formatNumber(num);
  } catch {
    return "";
  }
}

function formatDate(dateString: string): string {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return dateString;
  }
}

export default function TransactionsClient({
  accounts,
  categories,
  transfers,
  initialCategoryId,
}: {
  accounts: Account[];
  categories: Category[];
  transfers: Transfer[];
  initialCategoryId: string | null;
}) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState(initialCategoryId || (categories[0]?.id ?? ""));

  // Form states
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [transferType, setTransferType] = useState<TransferType>("payment");
  const [description, setDescription] = useState("");
  const [label, setLabel] = useState("");
  const [submitDraft, setSubmitDraft] = useState(true);

  // Filter accounts by selected category
  const categoryAccounts = accounts.filter((acc) => acc.categoryId === selectedCategoryId);

  function handleCategoryChange(categoryId: string) {
    setSelectedCategoryId(categoryId);
    router.push(`/dashboard/transactions?categoryId=${categoryId}`);
  }

  function openModal() {
    setShowModal(true);
    setFromAccountId("");
    setToAccountId("");
    setAmount("");
    setTransferType("payment");
    setDescription("");
    setLabel("");
    setSubmitDraft(true);
    setError(null);
  }

  function closeModal() {
    setShowModal(false);
    setError(null);
  }

  async function handleCreateTransfer() {
    if (!fromAccountId || !toAccountId || !amount) {
      setError("Please fill in all required fields");
      return;
    }

    if (fromAccountId === toAccountId) {
      setError("From and To accounts must be different");
      return;
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Amount must be a positive number");
      return;
    }

    setError(null);
    setIsBusy(true);

    try {
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromAccountId,
          toAccountId,
          amount: numAmount,
          type: transferType,
          status: submitDraft ? "submitted" : "draft",
          description: description.trim() || undefined,
          label: label.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && (data.reason || data.error)) || "Failed to create transfer");
        return;
      }

      closeModal();
      router.refresh();
    } catch {
      setError("Failed to create transfer");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Transactions</h1>
          <p className="dashboard-subtitle">View and manage transfers for your accounts.</p>
        </div>
        <button type="button" className="button" onClick={openModal} aria-label="Add transaction">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginRight: "8px" }}
          >
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Add Transaction
        </button>
      </header>

      {/* Category Switcher */}
      {categories.length > 0 && (
        <div style={{ marginBottom: "24px" }}>
          <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
            Category
          </label>
          <select
            className="setup-input"
            value={selectedCategoryId}
            onChange={(e) => handleCategoryChange(e.target.value)}
            style={{ maxWidth: "300px" }}
          >
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Transactions</div>
            <div className="panel-subtitle">
              {transfers.length > 0
                ? `${transfers.length} transaction${transfers.length === 1 ? "" : "s"} found`
                : "No transactions found"}
            </div>
          </div>
        </div>

        {transfers.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--text-secondary)" }}>
            <p>No transactions found for this category.</p>
            <p style={{ fontSize: "14px", marginTop: "8px" }}>Click &ldquo;Add Transaction&rdquo; to create one.</p>
          </div>
        ) : (
          <div className="table">
            <div className="table-head">
              <div>Date</div>
              <div>From</div>
              <div>To</div>
              <div>Label</div>
              <div>Status</div>
              <div className="table-amount">Amount</div>
            </div>

            {transfers.map((transfer) => (
              <div key={transfer.id} className="table-row">
                <div className="table-muted">{formatDate(transfer.createdAt)}</div>
                <div>{transfer.fromAccountName}</div>
                <div>{transfer.toAccountName}</div>
                <div className="table-muted">{transfer.label || "-"}</div>
                <div>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      backgroundColor:
                        transfer.status === "posted"
                          ? "#d1fae5"
                          : transfer.status === "pending"
                            ? "#fef3c7"
                            : transfer.status === "draft"
                              ? "#e5e7eb"
                              : transfer.status === "failed"
                                ? "#fee2e2"
                                : "#dbeafe",
                      color:
                        transfer.status === "posted"
                          ? "#065f46"
                          : transfer.status === "pending"
                            ? "#92400e"
                            : transfer.status === "draft"
                              ? "#374151"
                              : transfer.status === "failed"
                                ? "#991b1b"
                                : "#1e40af",
                    }}
                  >
                    {transfer.status}
                  </span>
                </div>
                <div className="table-amount">{formatNumber(transfer.amount)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal for creating transfer */}
      {showModal && (
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
              <div className="panel-title">Add Transfer</div>
            </div>
            <div style={{ padding: "20px", backgroundColor: "var(--bg-primary, #ffffff)" }}>
              {error && (
                <div
                  style={{
                    marginBottom: "16px",
                    padding: "12px",
                    backgroundColor: "#fee2e2",
                    border: "1px solid #ef4444",
                    borderRadius: "8px",
                    color: "#991b1b",
                  }}
                >
                  {error}
                </div>
              )}

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  From Account *
                </label>
                <select
                  className="setup-input"
                  value={fromAccountId}
                  onChange={(e) => setFromAccountId(e.target.value)}
                  disabled={isBusy}
                  style={{ width: "100%" }}
                >
                  <option value="">Select account</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.categoryName}){acc.balance ? ` - Balance: ${formatBalance(acc.balance)}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  To Account *
                </label>
                <select
                  className="setup-input"
                  value={toAccountId}
                  onChange={(e) => setToAccountId(e.target.value)}
                  disabled={isBusy}
                  style={{ width: "100%" }}
                >
                  <option value="">Select account</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.categoryName}){acc.balance ? ` - Balance: ${formatBalance(acc.balance)}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  Amount *
                </label>
                <input
                  className="setup-input"
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Enter amount"
                  disabled={isBusy}
                  style={{ width: "100%" }}
                  autoFocus
                />
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  Type *
                </label>
                <select
                  className="setup-input"
                  value={transferType}
                  onChange={(e) => setTransferType(e.target.value as TransferType)}
                  disabled={isBusy}
                  style={{ width: "100%" }}
                >
                  {TRANSFER_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  Label
                </label>
                <input
                  className="setup-input"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g., Rent, Groceries, Salary"
                  disabled={isBusy}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  Description
                </label>
                <textarea
                  className="setup-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Additional notes..."
                  disabled={isBusy}
                  style={{ width: "100%", minHeight: "80px", resize: "vertical" }}
                />
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "flex", alignItems: "center", fontSize: "14px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={submitDraft}
                    onChange={(e) => setSubmitDraft(e.target.checked)}
                    disabled={isBusy}
                    style={{ marginRight: "8px" }}
                  />
                  Submit for processing (uncheck to save as draft)
                </label>
              </div>

              <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                <button type="button" className="button button-ghost" onClick={closeModal} disabled={isBusy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={handleCreateTransfer}
                  disabled={isBusy || !fromAccountId || !toAccountId || !amount}
                >
                  {isBusy ? "Creating…" : submitDraft ? "Submit Transfer" : "Save Draft"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
