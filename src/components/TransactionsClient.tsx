"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Account = {
  id: string;
  name: string;
  categoryName: string;
  categoryId: string;
  balance?: string;
  type?: string;
};

type MetadataEntry = {
  key: string;
  value: string;
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
  externalAccountId,
}: {
  accounts: Account[];
  categories: Category[];
  transfers: Transfer[];
  initialCategoryId: string | null;
  externalAccountId?: string;
}) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [showTransactionMenu, setShowTransactionMenu] = useState(false);
  const [modalMode, setModalMode] = useState<"manual" | "buygoods" | "sendmoney">("manual");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState(initialCategoryId || (categories[0]?.id ?? ""));

  // Form states
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [buyGoodsNumber, setBuyGoodsNumber] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [transferType, setTransferType] = useState<TransferType>("payment");
  const [description, setDescription] = useState("");
  const [label, setLabel] = useState("");
  const [transactionDate, setTransactionDate] = useState("");
  const [submitDraft, setSubmitDraft] = useState(true);
  
  // External account metadata (for transfers to external accounts)
  const [customMetadata, setCustomMetadata] = useState<MetadataEntry[]>([]);
  
  // External account details (user-editable for metadata)
  const [extMetaId, setExtMetaId] = useState("");
  const [extMetaName, setExtMetaName] = useState("");
  const [extMetaType, setExtMetaType] = useState("");
  const [externalTransactionId, setExternalTransactionId] = useState("");
  
  // Check if either from or to account is the external account
  const isFromExternalAccount = externalAccountId ? fromAccountId === externalAccountId : false;
  const isToExternalAccount = externalAccountId ? toAccountId === externalAccountId : false;
  const involvesExternalAccount = isFromExternalAccount || isToExternalAccount;

  // Note: categoryAccounts can be used for category-specific filtering if needed
  // const categoryAccounts = accounts.filter((acc) => acc.categoryId === selectedCategoryId);

  function handleCategoryChange(categoryId: string) {
    setSelectedCategoryId(categoryId);
    router.push(`/dashboard/transactions?categoryId=${categoryId}`);
  }

  function openModal() {
    setModalMode("manual");
    setShowModal(true);
    setFromAccountId("");
    setToAccountId("");
    setBuyGoodsNumber("");
    setAmount("");
    setTransferType("payment");
    setDescription("");
    setLabel("");
    setTransactionDate(new Date().toISOString().split("T")[0]); // Default to today
    setCustomMetadata([]);
    setExtMetaId("");
    setExtMetaName("");
    setExtMetaType("");
    setExternalTransactionId("");
    setSubmitDraft(true);
    setError(null);
  }

  function addMetadataEntry() {
    setCustomMetadata([...customMetadata, { key: "", value: "" }]);
  }

  function updateMetadataEntry(index: number, field: "key" | "value", value: string) {
    const updated = [...customMetadata];
    updated[index][field] = value;
    setCustomMetadata(updated);
  }

  function removeMetadataEntry(index: number) {
    setCustomMetadata(customMetadata.filter((_, i) => i !== index));
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

    // Validate external account details if transfer involves external account
    if (involvesExternalAccount) {
      if (!extMetaId.trim() || !extMetaName.trim() || !extMetaType.trim()) {
        setError("External account details (ID, Name, and Type) are required when transferring to/from an external account");
        return;
      }
      if (!externalTransactionId.trim()) {
        setError("External Transaction ID is required when transferring to/from an external account");
        return;
      }
    }

    setError(null);
    setIsBusy(true);

    try {
      // Convert date to ISO string with time at midnight UTC if provided
      let createdAt: string | undefined;
      if (transactionDate) {
        createdAt = new Date(transactionDate + "T00:00:00.000Z").toISOString();
      }

      // Build metadata object
      let metadata: Record<string, unknown> | undefined;
      
      // Add user-entered external account info if any field is filled
      const hasExternalAccountData = extMetaId.trim() || extMetaName.trim() || extMetaType.trim();
      if (hasExternalAccountData) {
        metadata = {
          external_account: {
            id: extMetaId.trim() || undefined,
            name: extMetaName.trim() || undefined,
            type: extMetaType.trim() || undefined,
          },
        };
        // Remove undefined properties from external_account
        const extAcc = metadata.external_account as Record<string, unknown>;
        Object.keys(extAcc).forEach(key => {
          if (extAcc[key] === undefined) delete extAcc[key];
        });
      }
      
      // Add custom metadata entries
      if (customMetadata.length > 0) {
        const validEntries = customMetadata.filter(entry => entry.key.trim() && entry.value.trim());
        if (validEntries.length > 0) {
          if (!metadata) metadata = {};
          for (const entry of validEntries) {
            metadata[entry.key.trim()] = entry.value.trim();
          }
        }
      }

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
          createdAt,
          metadata,
          externalTransactionId: involvesExternalAccount && externalTransactionId.trim() ? externalTransactionId.trim() : undefined,
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

  async function handleBuyGoodsPayment() {
    if (!fromAccountId || !buyGoodsNumber.trim() || !amount) {
      setError("Please fill in all required fields");
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
          // No toAccountId for buy goods
          amount: numAmount,
          type: transferType,
          status: submitDraft ? "submitted" : "draft",
          description: description.trim() || undefined,
          label: label.trim() || undefined,
          paymentChannel: {
            channelId: "BusinessBuyGoods",
            toAccount: buyGoodsNumber.trim(),
          },
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && (data.reason || data.error)) || "Failed to create buy goods payment");
        return;
      }

      closeModal();
      router.refresh();
    } catch {
      setError("Failed to create buy goods payment");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSendMoney() {
    if (!fromAccountId || !phoneNumber.trim() || !amount) {
      setError("Please fill in all required fields");
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
          // No toAccountId for send money
          amount: numAmount,
          type: transferType,
          status: submitDraft ? "submitted" : "draft",
          description: description.trim() || undefined,
          label: label.trim() || undefined,
          paymentChannel: {
            channelId: "BusinessPayment",
            toAccount: phoneNumber.trim(),
          },
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && (data.reason || data.error)) || "Failed to create send money payment");
        return;
      }

      closeModal();
      router.refresh();
    } catch {
      setError("Failed to create send money payment");
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
        <div style={{ position: "relative" }}>
          <button 
            type="button" 
            className="button button-ghost" 
            onClick={() => setShowTransactionMenu(!showTransactionMenu)} 
            aria-label="Transaction options"
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
              <circle cx="12" cy="12" r="1"></circle>
              <circle cx="12" cy="5" r="1"></circle>
              <circle cx="12" cy="19" r="1"></circle>
            </svg>
          </button>
          {showTransactionMenu && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: "8px",
                backgroundColor: "var(--bg-primary, #ffffff)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                zIndex: 10,
                minWidth: "220px",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setShowTransactionMenu(false);
                  openModal();
                }}
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
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover, #f5f5f5)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                📝 Record Manual Transaction
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowTransactionMenu(false);
                  setModalMode("sendmoney");
                  setShowModal(true);
                  setFromAccountId("");
                  setPhoneNumber("");
                  setAmount("");
                  setTransferType("payment");
                  setDescription("");
                  setLabel("");
                  setSubmitDraft(true);
                  setError(null);
                }}
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
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover, #f5f5f5)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                💸 M-Pesa Send Money
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowTransactionMenu(false);
                  setModalMode("buygoods");
                  setShowModal(true);
                  setFromAccountId("");
                  setBuyGoodsNumber("");
                  setAmount("");
                  setTransferType("payment");
                  setDescription("");
                  setLabel("");
                  setSubmitDraft(true);
                  setError(null);
                }}
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
                  borderTop: "1px solid var(--border)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover, #f5f5f5)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                🛒 Pay via Buy Goods
              </button>
            </div>
          )}
        </div>
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
            style={{ 
              width: "90%", 
              maxWidth: "500px", 
              maxHeight: "90vh",
              margin: "20px", 
              backgroundColor: "var(--bg-primary, #ffffff)",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header" style={{ flexShrink: 0 }}>
              <div className="panel-title">
                {modalMode === "buygoods" ? "Pay via Buy Goods" : modalMode === "sendmoney" ? "M-Pesa Send Money" : "Add Transfer"}
              </div>
            </div>
            <div style={{ 
              padding: "20px", 
              backgroundColor: "var(--bg-primary, #ffffff)",
              overflowY: "auto",
              flex: 1,
            }}>
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
                  style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}
                >
                  <option value="">Select account</option>
                  {accounts
                    .filter((acc) => modalMode === "manual" ? acc.id !== toAccountId : true)
                    .map((acc) => {
                      const isExternal = externalAccountId && acc.id === externalAccountId;
                      return (
                        <option key={acc.id} value={acc.id}>
                          {isExternal 
                            ? acc.name 
                            : `${acc.name} (${acc.categoryName})${acc.balance ? ` - Balance: ${formatBalance(acc.balance)}` : ""}`
                          }
                        </option>
                      );
                    })}
                </select>
              </div>

              {modalMode === "manual" ? (
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                    To Account *
                  </label>
                  <select
                    className="setup-input"
                    value={toAccountId}
                    onChange={(e) => setToAccountId(e.target.value)}
                    disabled={isBusy}
                    style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}
                  >
                    <option value="">Select account</option>
                    {accounts
                      .filter((acc) => acc.id !== fromAccountId)
                      .map((acc) => {
                        const isExternal = externalAccountId && acc.id === externalAccountId;
                        return (
                          <option key={acc.id} value={acc.id}>
                            {isExternal 
                              ? acc.name 
                              : `${acc.name} (${acc.categoryName})${acc.balance ? ` - Balance: ${formatBalance(acc.balance)}` : ""}`
                            }
                          </option>
                        );
                      })}
                  </select>
                </div>
              ) : modalMode === "buygoods" ? (
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                    Buy Goods Till Number *
                  </label>
                  <input
                    className="setup-input"
                    type="text"
                    value={buyGoodsNumber}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Only allow digits
                      if (/^\d*$/.test(value)) {
                        setBuyGoodsNumber(value);
                      }
                    }}
                    placeholder="e.g., 123456"
                    disabled={isBusy}
                    maxLength={10}
                    style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}
                  />
                  <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                    Enter the merchant&apos;s till number
                  </div>
                </div>
              ) : (
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                    Phone Number *
                  </label>
                  <input
                    className="setup-input"
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Only allow digits and max 12 characters
                      if (/^\d*$/.test(value)) {
                        setPhoneNumber(value.slice(0, 12));
                      }
                    }}
                    placeholder="e.g., 254712345678"
                    disabled={isBusy}
                    maxLength={12}
                    style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}
                  />
                  <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                    Enter recipient&apos;s phone number (include country code)
                  </div>
                </div>
              )}

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
                  style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}
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
                  style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}
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
                  style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}
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
                  style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box", minHeight: "80px", resize: "vertical" }}
                />
              </div>

              {modalMode === "manual" && (
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                    Transaction Date
                  </label>
                  <input
                    className="setup-input"
                    type="date"
                    value={transactionDate}
                    onChange={(e) => setTransactionDate(e.target.value)}
                    disabled={isBusy}
                    style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}
                  />
                  <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                    When did this transaction occur? Defaults to today.
                  </div>
                </div>
              )}

              {/* Additional Metadata Section - Show for all manual transactions */}
              {modalMode === "manual" && (
                <div
                  style={{
                    marginBottom: "16px",
                    padding: "16px",
                    backgroundColor: "var(--bg-secondary, #f9fafb)",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div style={{ marginBottom: "12px" }}>
                    <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>
                      📋 Additional Metadata
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                      Add details about the external recipient or any custom data for this transaction.
                    </div>
                  </div>

                  {/* External Account Details - Only show when involving external account */}
                  {involvesExternalAccount && (
                    <div style={{ marginBottom: "16px" }}>
                      <div style={{ fontSize: "13px", fontWeight: 500, marginBottom: "8px" }}>
                        🏦 External Account Details *
                      </div>
                      <div style={{ 
                        marginBottom: "8px", 
                        padding: "8px", 
                        backgroundColor: "#fef3c7", 
                        borderRadius: "4px",
                        fontSize: "12px",
                        color: "#92400e"
                      }}>
                        ⚠️ External account details are required when transferring to/from an external account.
                      </div>
                      <div style={{ marginBottom: "8px" }}>
                        <input
                          className="setup-input"
                          type="text"
                          value={externalTransactionId}
                          onChange={(e) => setExternalTransactionId(e.target.value)}
                          placeholder="Transaction ID *"
                          disabled={isBusy}
                          style={{ 
                            width: "100%",
                            maxWidth: "100%",
                            boxSizing: "border-box",
                            borderColor: !externalTransactionId.trim() ? "#f59e0b" : undefined
                          }}
                        />
                        <div style={{ marginTop: "2px", fontSize: "11px", color: "var(--text-secondary, #666)" }}>
                          e.g., receipt number, bank reference
                        </div>
                      </div>
                      <div style={{ marginBottom: "8px" }}>
                        <input
                          className="setup-input"
                          type="text"
                          value={extMetaId}
                          onChange={(e) => setExtMetaId(e.target.value)}
                          placeholder="Account ID *"
                          disabled={isBusy}
                          style={{ 
                            width: "100%",
                            maxWidth: "100%",
                            boxSizing: "border-box",
                            borderColor: !extMetaId.trim() ? "#f59e0b" : undefined
                          }}
                        />
                        <div style={{ marginTop: "2px", fontSize: "11px", color: "var(--text-secondary, #666)" }}>
                          e.g., bank account, vendor ID
                        </div>
                      </div>
                      <div style={{ marginBottom: "8px" }}>
                        <input
                          className="setup-input"
                          type="text"
                          value={extMetaName}
                          onChange={(e) => setExtMetaName(e.target.value)}
                          placeholder="Account Name *"
                          disabled={isBusy}
                          style={{ 
                            width: "100%",
                            maxWidth: "100%",
                            boxSizing: "border-box",
                            borderColor: !extMetaName.trim() ? "#f59e0b" : undefined
                          }}
                        />
                        <div style={{ marginTop: "2px", fontSize: "11px", color: "var(--text-secondary, #666)" }}>
                          e.g., vendor name, bank name
                        </div>
                      </div>
                      <div>
                        <input
                          className="setup-input"
                          type="text"
                          value={extMetaType}
                          onChange={(e) => setExtMetaType(e.target.value)}
                          placeholder="Account Type *"
                          disabled={isBusy}
                          style={{ 
                            width: "100%",
                            maxWidth: "100%",
                            boxSizing: "border-box",
                            borderColor: !extMetaType.trim() ? "#f59e0b" : undefined
                          }}
                        />
                        <div style={{ marginTop: "2px", fontSize: "11px", color: "var(--text-secondary, #666)" }}>
                          e.g., bank, vendor, supplier
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Custom metadata entries */}
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: 500, marginBottom: "8px" }}>
                      Custom Fields (Optional)
                    </div>
                    {customMetadata.map((entry, index) => (
                      <div key={index} style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                        <input
                          className="setup-input"
                          type="text"
                          value={entry.key}
                          onChange={(e) => updateMetadataEntry(index, "key", e.target.value)}
                          placeholder="Key"
                          disabled={isBusy}
                          style={{ flex: 1 }}
                        />
                        <input
                          className="setup-input"
                          type="text"
                          value={entry.value}
                          onChange={(e) => updateMetadataEntry(index, "value", e.target.value)}
                          placeholder="Value"
                          disabled={isBusy}
                          style={{ flex: 2 }}
                        />
                        <button
                          type="button"
                          onClick={() => removeMetadataEntry(index)}
                          disabled={isBusy}
                          style={{
                            padding: "8px 12px",
                            border: "1px solid var(--border)",
                            borderRadius: "4px",
                            backgroundColor: "transparent",
                            cursor: "pointer",
                            color: "#ef4444",
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addMetadataEntry}
                      disabled={isBusy}
                      style={{
                        padding: "8px 12px",
                        border: "1px dashed var(--border)",
                        borderRadius: "4px",
                        backgroundColor: "transparent",
                        cursor: "pointer",
                        fontSize: "13px",
                        width: "100%",
                      }}
                    >
                      + Add Custom Field
                    </button>
                  </div>
                </div>
              )}

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
                  onClick={
                    modalMode === "buygoods"
                      ? handleBuyGoodsPayment
                      : modalMode === "sendmoney"
                        ? handleSendMoney
                        : handleCreateTransfer
                  }
                  disabled={
                    isBusy ||
                    !fromAccountId ||
                    !amount ||
                    (modalMode === "manual" && !toAccountId) ||
                    (modalMode === "manual" && involvesExternalAccount && (!externalTransactionId.trim() || !extMetaId.trim() || !extMetaName.trim() || !extMetaType.trim())) ||
                    (modalMode === "buygoods" && !buyGoodsNumber.trim()) ||
                    (modalMode === "sendmoney" && !phoneNumber.trim())
                  }
                >
                  {isBusy
                    ? modalMode === "buygoods"
                      ? "Processing…"
                      : modalMode === "sendmoney"
                        ? "Sending…"
                        : "Creating…"
                    : submitDraft
                      ? modalMode === "buygoods"
                        ? "Submit Payment"
                        : modalMode === "sendmoney"
                          ? "Send Money"
                          : "Submit Transfer"
                      : "Save Draft"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
