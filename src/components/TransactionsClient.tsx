"use client";

import { useState, useEffect, useCallback } from "react";
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
  fromAccountId: string;
  toAccountId?: string;
  fromAccountName: string;
  toAccountName: string;
  amount: number;
  type: string;
  status: string;
  label?: string;
  description?: string;
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
  createdByName?: string;
  externalTransactionId?: string;
  tbTransferId?: string;
  parentTransferId?: string;
  linkRole?: string;
  paymentIntegrationLink?: string;
  metadata?: Record<string, unknown>;
  paymentChannel?: Record<string, unknown>;
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

    if (diffDays === 0) {
      // For today, show the time
      return `Today ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
    }
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
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  
  // Detail modal state
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);

  // Form states
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [buyGoodsNumber, setBuyGoodsNumber] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [displayAmount, setDisplayAmount] = useState("");
  const [transferType, setTransferType] = useState<TransferType>("payment");
  const [description, setDescription] = useState("");
  const [label, setLabel] = useState("");
  const [transactionDate, setTransactionDate] = useState("");
  const [submitDraft, setSubmitDraft] = useState(true);
  
  // Account balances (preloaded in background on mount)
  const [accountBalances, setAccountBalances] = useState<Record<string, string>>({});
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [balancesLoaded, setBalancesLoaded] = useState(false);
  
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

  // Filter accounts by selected category
  const categoryAccounts = accounts.filter((acc) => acc.categoryId === selectedCategoryId);

  function handleCategoryChange(categoryId: string) {
    setSelectedCategoryId(categoryId);
    setSelectedAccountId(""); // Reset account filter when category changes
    router.push(`/dashboard/transactions?categoryId=${categoryId}`);
  }

  function handleAccountChange(accountId: string) {
    setSelectedAccountId(accountId);
  }

  // Fetch account balances (can be called on demand or preloaded)
  const fetchAccountBalances = useCallback(async () => {
    if (loadingBalances || balancesLoaded) return;
    setLoadingBalances(true);
    try {
      const res = await fetch("/api/settings/accounts?withBalances=true");
      if (res.ok) {
        const data = await res.json();
        if (data.accounts) {
          const balances: Record<string, string> = {};
          for (const acc of data.accounts) {
            if (acc.balance) {
              balances[acc.id] = acc.balance;
            }
          }
          setAccountBalances(balances);
          setBalancesLoaded(true);
        }
      }
    } catch (err) {
      console.error("Failed to fetch account balances:", err);
    } finally {
      setLoadingBalances(false);
    }
  }, [loadingBalances, balancesLoaded]);

  // Preload account balances in background when component mounts
  useEffect(() => {
    // Start fetching balances after a short delay to not block initial render
    const timer = setTimeout(() => {
      void fetchAccountBalances();
    }, 100);
    return () => clearTimeout(timer);
  }, [fetchAccountBalances]);

  // Filter transfers by selected account (if any)
  const filteredTransfers = selectedAccountId 
    ? transfers.filter((t) => t.fromAccountId === selectedAccountId || t.toAccountId === selectedAccountId)
    : transfers;

  function openModal() {
    setModalMode("manual");
    setShowModal(true);
    // If account filter is selected, pre-select it as From Account
    setFromAccountId(selectedAccountId || "");
    setToAccountId("");
    setBuyGoodsNumber("");
    setAmount("");
    setDisplayAmount("");
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
    // Lazy-load account balances when modal opens
    void fetchAccountBalances();
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
                  // If account filter is selected, pre-select it as From Account
                  setFromAccountId(selectedAccountId || "");
                  setPhoneNumber("");
                  setAmount("");
                  setDisplayAmount("");
                  setTransferType("payment");
                  setDescription("");
                  setLabel("");
                  setSubmitDraft(true);
                  setError(null);
                  // Lazy-load account balances
                  void fetchAccountBalances();
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
                  // If account filter is selected, pre-select it as From Account
                  setFromAccountId(selectedAccountId || "");
                  setBuyGoodsNumber("");
                  setAmount("");
                  setDisplayAmount("");
                  setTransferType("payment");
                  setDescription("");
                  setLabel("");
                  setSubmitDraft(true);
                  setError(null);
                  // Lazy-load account balances
                  void fetchAccountBalances();
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

      {/* Filters */}
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "24px" }}>
        {/* Category Switcher */}
        {categories.length > 0 && (
          <div style={{ flex: "1", minWidth: "200px", maxWidth: "300px" }}>
            <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
              Category
            </label>
            <select
              className="setup-input"
              value={selectedCategoryId}
              onChange={(e) => handleCategoryChange(e.target.value)}
              style={{ width: "100%" }}
            >
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Account Filter */}
        <div style={{ flex: "1", minWidth: "200px", maxWidth: "300px" }}>
          <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
            Account
          </label>
          <select
            className="setup-input"
            value={selectedAccountId}
            onChange={(e) => handleAccountChange(e.target.value)}
            style={{ width: "100%" }}
          >
            <option value="">All Accounts</option>
            {categoryAccounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Transactions</div>
            <div className="panel-subtitle">
              {filteredTransfers.length > 0
                ? `${filteredTransfers.length} transaction${filteredTransfers.length === 1 ? "" : "s"} found${selectedAccountId ? " for selected account" : ""}`
                : "No transactions found"}
            </div>
          </div>
        </div>

        {filteredTransfers.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--text-secondary)" }}>
            <p>No transactions found{selectedAccountId ? " for this account" : " for this category"}.</p>
            <p style={{ fontSize: "14px", marginTop: "8px" }}>Click the menu to create a transaction.</p>
          </div>
        ) : (
          <div className="table">
            <div className="table-head">
              <div>Date</div>
              <div>From</div>
              <div>To</div>
              <div>Reference</div>
              <div>Status</div>
              <div className="table-amount">Amount</div>
            </div>

              {filteredTransfers.map((transfer) => (
              <div 
                key={transfer.id} 
                className="table-row"
                onClick={() => setSelectedTransfer(transfer)}
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover, #f5f5f5)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <div className="table-muted" data-label="Date">{formatDate(transfer.createdAt)}</div>
                <div data-label="From">{transfer.fromAccountName}</div>
                <div data-label="To">{transfer.toAccountName}</div>
                <div className="table-muted table-ref" data-label="Ref" style={{ fontFamily: transfer.externalTransactionId ? "monospace" : undefined, fontSize: transfer.externalTransactionId ? "11px" : undefined }}>
                  {transfer.externalTransactionId || transfer.label || "-"}
                </div>
                <div data-label="Status">
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontSize: "11px",
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
                <div className="table-amount" data-label="Amount">{formatNumber(transfer.amount)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Transfer Detail Modal */}
      {selectedTransfer && (
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
          onClick={() => setSelectedTransfer(null)}
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
            <div className="panel-header" style={{ flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="panel-title">Transfer Details</div>
              <button
                type="button"
                onClick={() => setSelectedTransfer(null)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "20px",
                  cursor: "pointer",
                  padding: "4px 8px",
                  color: "var(--text-secondary, #666)",
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ 
              padding: "20px", 
              backgroundColor: "var(--bg-primary, #ffffff)",
              overflowY: "auto",
              flex: 1,
            }}>
              {/* Status Badge */}
              <div style={{ marginBottom: "20px", textAlign: "center" }}>
                <span
                  style={{
                    padding: "6px 16px",
                    borderRadius: "20px",
                    fontSize: "14px",
                    fontWeight: 500,
                    backgroundColor:
                      selectedTransfer.status === "posted"
                        ? "#d1fae5"
                        : selectedTransfer.status === "pending"
                          ? "#fef3c7"
                          : selectedTransfer.status === "draft"
                            ? "#e5e7eb"
                            : selectedTransfer.status === "failed"
                              ? "#fee2e2"
                              : "#dbeafe",
                    color:
                      selectedTransfer.status === "posted"
                        ? "#065f46"
                        : selectedTransfer.status === "pending"
                          ? "#92400e"
                          : selectedTransfer.status === "draft"
                            ? "#374151"
                            : selectedTransfer.status === "failed"
                              ? "#991b1b"
                              : "#1e40af",
                  }}
                >
                  {selectedTransfer.status.toUpperCase()}
                </span>
              </div>

              {/* Amount */}
              <div style={{ marginBottom: "24px", textAlign: "center" }}>
                <div style={{ fontSize: "32px", fontWeight: 600 }}>
                  {formatNumber(selectedTransfer.amount)}
                </div>
                <div style={{ fontSize: "14px", color: "var(--text-secondary, #666)", marginTop: "4px" }}>
                  {selectedTransfer.type}
                </div>
              </div>

              {/* Transfer Flow */}
              <div style={{ 
                marginBottom: "20px", 
                padding: "16px", 
                backgroundColor: "var(--bg-secondary, #f9fafb)", 
                borderRadius: "8px" 
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary, #666)", marginBottom: "4px" }}>From</div>
                    <div style={{ fontWeight: 500 }}>{selectedTransfer.fromAccountName}</div>
                  </div>
                  <div style={{ padding: "0 16px", color: "var(--text-secondary, #666)" }}>→</div>
                  <div style={{ flex: 1, textAlign: "right" }}>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary, #666)", marginBottom: "4px" }}>To</div>
                    <div style={{ fontWeight: 500 }}>
                      {(() => {
                        // Check if payment_channel has to_account
                        const paymentChannel = selectedTransfer.paymentChannel;
                        if (paymentChannel && typeof paymentChannel === 'object') {
                          const toAccount = paymentChannel['to_account'] || paymentChannel['toAccount'];
                          if (toAccount) return String(toAccount);
                        }
                        return selectedTransfer.toAccountName;
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Details Grid */}
              <div style={{ display: "grid", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--text-secondary, #666)" }}>Date</span>
                  <span>{selectedTransfer.createdAt ? new Date(selectedTransfer.createdAt).toLocaleString() : "-"}</span>
                </div>
                
                {selectedTransfer.label && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--text-secondary, #666)" }}>Label</span>
                    <span>{selectedTransfer.label}</span>
                  </div>
                )}
                
                {selectedTransfer.description && (
                  <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ color: "var(--text-secondary, #666)", marginBottom: "4px" }}>Description</div>
                    <div>{selectedTransfer.description}</div>
                  </div>
                )}
                
                {selectedTransfer.externalTransactionId && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--text-secondary, #666)" }}>External Transaction ID</span>
                    <span style={{ fontFamily: "monospace", fontSize: "13px" }}>{selectedTransfer.externalTransactionId}</span>
                  </div>
                )}
                
                {selectedTransfer.createdByName && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--text-secondary, #666)" }}>Created By</span>
                    <span>{selectedTransfer.createdByName}</span>
                  </div>
                )}
                
                {selectedTransfer.updatedAt && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--text-secondary, #666)" }}>Updated At</span>
                    <span>{new Date(selectedTransfer.updatedAt).toLocaleString()}</span>
                  </div>
                )}
                
                {selectedTransfer.paymentChannel && Object.keys(selectedTransfer.paymentChannel).length > 0 && (
                  <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", overflow: "hidden" }}>
                    <div style={{ color: "var(--text-secondary, #666)", marginBottom: "4px" }}>Payment Channel</div>
                    <div style={{ overflow: "auto", maxWidth: "100%" }}>
                      <pre style={{ 
                        margin: 0, 
                        fontSize: "12px", 
                        backgroundColor: "var(--bg-secondary, #f9fafb)", 
                        padding: "8px", 
                        borderRadius: "4px",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word"
                      }}>
                        {JSON.stringify(selectedTransfer.paymentChannel, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
                
                {selectedTransfer.linkRole && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--text-secondary, #666)" }}>Link Role</span>
                    <span style={{ 
                      padding: "2px 8px", 
                      borderRadius: "4px", 
                      fontSize: "12px",
                      backgroundColor: "#e0e7ff",
                      color: "#3730a3"
                    }}>{selectedTransfer.linkRole}</span>
                  </div>
                )}
                
                {selectedTransfer.parentTransferId && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--text-secondary, #666)" }}>Parent Transfer ID</span>
                    <span style={{ fontFamily: "monospace", fontSize: "12px" }}>{selectedTransfer.parentTransferId}</span>
                  </div>
                )}
                
                {selectedTransfer.tbTransferId && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--text-secondary, #666)" }}>TigerBeetle Transfer ID</span>
                    <span style={{ fontFamily: "monospace", fontSize: "12px" }}>{selectedTransfer.tbTransferId}</span>
                  </div>
                )}
                
                {selectedTransfer.paymentIntegrationLink && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--text-secondary, #666)" }}>Payment Integration Link</span>
                    <span style={{ fontFamily: "monospace", fontSize: "12px" }}>{selectedTransfer.paymentIntegrationLink}</span>
                  </div>
                )}
                
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--text-secondary, #666)" }}>Transfer ID</span>
                  <span style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--text-secondary, #666)" }}>{selectedTransfer.id}</span>
                </div>
                
                {selectedTransfer.fromAccountId && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--text-secondary, #666)" }}>From Account ID</span>
                    <span style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--text-secondary, #666)" }}>{selectedTransfer.fromAccountId}</span>
                  </div>
                )}
                
                {selectedTransfer.toAccountId && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ color: "var(--text-secondary, #666)" }}>To Account ID</span>
                    <span style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--text-secondary, #666)" }}>{selectedTransfer.toAccountId}</span>
                  </div>
                )}
              </div>

              {/* Metadata Section */}
              {selectedTransfer.metadata && Object.keys(selectedTransfer.metadata).length > 0 && (
                <div style={{ marginTop: "20px", overflow: "hidden" }}>
                  <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>Metadata</div>
                  <div style={{ 
                    padding: "12px", 
                    backgroundColor: "var(--bg-secondary, #f9fafb)", 
                    borderRadius: "8px",
                    fontSize: "13px",
                    overflow: "hidden",
                  }}>
                    {Object.entries(selectedTransfer.metadata).map(([key, value]) => (
                      <div key={key} style={{ marginBottom: "8px", overflow: "hidden" }}>
                        <div style={{ color: "var(--text-secondary, #666)", fontSize: "12px", marginBottom: "2px" }}>
                          {key}
                        </div>
                        <div style={{ wordBreak: "break-word", overflow: "hidden" }}>
                          {typeof value === "object" ? (
                            <div style={{ overflow: "auto", maxWidth: "100%" }}>
                              <pre style={{ 
                                margin: 0, 
                                fontSize: "12px", 
                                backgroundColor: "var(--bg-primary, #fff)", 
                                padding: "8px", 
                                borderRadius: "4px",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word"
                              }}>
                                {JSON.stringify(value, null, 2)}
                              </pre>
                            </div>
                          ) : (
                            String(value)
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            {/* Close Button */}
            <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border)", backgroundColor: "var(--bg-primary, #ffffff)" }}>
              <button
                type="button"
                className="button button-ghost"
                onClick={() => setSelectedTransfer(null)}
                style={{ width: "100%" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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
                {modalMode === "buygoods" ? "Pay via Buy Goods" : modalMode === "sendmoney" ? "M-Pesa Send Money" : "Record Transaction"}
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
                  {categoryAccounts
                    .filter((acc) => modalMode === "manual" ? acc.id !== toAccountId : true)
                    .map((acc) => {
                      const balance = accountBalances[acc.id];
                      return (
                        <option key={acc.id} value={acc.id}>
                          {acc.name}{balance ? ` - Balance: ${formatBalance(balance)}` : loadingBalances ? " (loading...)" : ""}
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
                        const balance = accountBalances[acc.id];
                        return (
                          <option key={acc.id} value={acc.id}>
                            {isExternal 
                              ? acc.name 
                              : `${acc.name} (${acc.categoryName})${balance ? ` - Balance: ${formatBalance(balance)}` : loadingBalances ? " (loading...)" : ""}`
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
                  type="text"
                  inputMode="decimal"
                  value={displayAmount}
                  onChange={(e) => {
                    const value = e.target.value;
                    // Remove commas to get raw value
                    const rawValue = value.replace(/,/g, "");
                    // Only allow digits and one decimal point
                    if (/^[0-9]*\.?[0-9]*$/.test(rawValue)) {
                      setAmount(rawValue);
                      // Format with commas for display
                      if (rawValue) {
                        const parts = rawValue.split(".");
                        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                        setDisplayAmount(parts.join("."));
                      } else {
                        setDisplayAmount("");
                      }
                    }
                  }}
                  placeholder="Enter amount (e.g., 1,000.00)"
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
                          : "Record Transaction"
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
