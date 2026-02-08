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
  isLinked: boolean;
  defaultAccountId?: string;
  paymentIntegrationId?: string;
  hasB2cPaybill?: boolean;
  b2cPaybillId?: string;
  paybillName?: string;
  b2cPaybillName?: string;
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
  // Use en-US locale for consistent formatting between server and client
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
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

// Extract balance from transfer metadata based on selected account
function getTransferBalance(
  transfer: Transfer,
  selectedAccountId: string
): string | null {
  if (!transfer.metadata || !selectedAccountId) return null;
  
  const transferBalance = transfer.metadata.transfer_balance as Record<string, unknown> | undefined;
  if (!transferBalance) return null;
  
  // Check if this account is the from or to account
  const isFromAccount = transfer.fromAccountId === selectedAccountId;
  const isToAccount = transfer.toAccountId === selectedAccountId;
  
  if (isFromAccount) {
    const fromBalance = transferBalance.from_account_balance as Record<string, unknown> | undefined;
    if (fromBalance?.book_balance) {
      // Handle decimal format like "48000dec"
      const balanceStr = String(fromBalance.book_balance);
      const numericPart = balanceStr.replace(/dec$/i, "");
      return numericPart;
    }
  } else if (isToAccount) {
    const toBalance = transferBalance.to_account_balance as Record<string, unknown> | undefined;
    if (toBalance?.book_balance) {
      // Handle decimal format like "-236089dec"
      const balanceStr = String(toBalance.book_balance);
      const numericPart = balanceStr.replace(/dec$/i, "");
      return numericPart;
    }
  }
  
  return null;
}

function formatDate(dateString: string): string {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    
    // Use consistent UTC-based formatting to avoid hydration mismatches
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const timeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.floor((today.getTime() - dateDay.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return `Today ${timeStr}`;
    }
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;

    // Use consistent format: "Feb 8, 2026"
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
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
  const [modalMode, setModalMode] = useState<"manual" | "buygoods" | "sendmoney" | "paybill">("manual");
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
  const [paybillNumber, setPaybillNumber] = useState("");
  const [accountReference, setAccountReference] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [displayAmount, setDisplayAmount] = useState("");
  const [transferType, setTransferType] = useState<TransferType>("payment");
  const [description, setDescription] = useState("");
  const [label, setLabel] = useState("");
  const [transactionDate, setTransactionDate] = useState("");
  const [transactionTime, setTransactionTime] = useState("");
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
  
  // For bagayi_inter_switch transfers to linked categories with b2c_paybill, user can choose which paybill
  const [selectedPaybillType, setSelectedPaybillType] = useState<"main" | "b2c">("main");
  
  // Frequent recipients for M-Pesa payments
  type FrequentRecipient = {
    toAccount: string;
    accountReference?: string;
    name: string;
    count: number;
  };
  const [frequentRecipients, setFrequentRecipients] = useState<FrequentRecipient[]>([]);
  const [loadingFrequent, setLoadingFrequent] = useState(false);
  
  // Fetch frequent recipients based on payment action
  const fetchFrequentRecipients = useCallback(async (action: "BusinessPayment" | "BusinessBuyGoods" | "BusinessPayBill") => {
    setLoadingFrequent(true);
    setFrequentRecipients([]);
    try {
      const params = new URLSearchParams({
        action,
        categoryId: selectedCategoryId,
        ...(selectedAccountId ? { accountId: selectedAccountId } : {}),
      });
      const res = await fetch(`/api/transfers/frequent?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.recipients) {
          setFrequentRecipients(data.recipients);
        }
      }
    } catch (err) {
      console.error("Failed to fetch frequent recipients:", err);
    } finally {
      setLoadingFrequent(false);
    }
  }, [selectedCategoryId, selectedAccountId]);
  
  // Check if either from or to account is the external account
  const isFromExternalAccount = externalAccountId ? fromAccountId === externalAccountId : false;
  const isToExternalAccount = externalAccountId ? toAccountId === externalAccountId : false;
  const involvesExternalAccount = isFromExternalAccount || isToExternalAccount;

  // Filter accounts by selected category
  const categoryAccounts = accounts.filter((acc) => acc.categoryId === selectedCategoryId);
  
  // Get from and to account objects
  const fromAccount = accounts.find((acc) => acc.id === fromAccountId);
  const toAccount = accounts.find((acc) => acc.id === toAccountId);
  
  // Get from and to categories
  // For from category, look up by the account's categoryId
  const fromCategory = categories.find((cat) => cat.id === fromAccount?.categoryId);
  
  // For to category, we need to find which root category the target account belongs to
  // This is the category that has this account as its defaultAccountId (for cross-category transfers)
  // or the account's direct category (for same-category transfers)
  const toCategory = (() => {
    if (!toAccount) return undefined;
    // First check if this account IS a default account of a root category
    const categoryWithThisDefault = categories.find((cat) => cat.defaultAccountId === toAccount.id);
    if (categoryWithThisDefault) return categoryWithThisDefault;
    // Otherwise, look up by the account's categoryId
    return categories.find((cat) => cat.id === toAccount.categoryId);
  })();
  
  // Check if transfer requires payment channel (cross-category transfer)
  // This is needed when:
  // 1. Both accounts exist
  // 2. They are in different ROOT categories (different category hierarchies)
  // 3. The from category is NOT linked to a payment integration (if linked, use mpesa channels)
  // 
  // When transferring between accounts in different category hierarchies,
  // we must use payment_channel with bagayi_inter_switch instead of to_account_id
  const requiresPaymentChannel = (() => {
    if (!fromAccount || !toAccount) return false;
    if (fromAccount.categoryId === toAccount.categoryId) return false;
    if (involvesExternalAccount) return false; // External account transfers don't require payment channel
    
    // If from category is linked to payment integration, use the integration's payment channels
    // (like BusinessPayment, BusinessBuyGoods) - not bagayi_inter_switch
    if (fromCategory?.isLinked) return false;
    
    // For all other cross-category transfers (from unlinked category to any other category),
    // we need bagayi_inter_switch payment channel
    return true;
  })();
  
  // Check if cross-category transfer is to a linked category
  // This requires external_transaction_id for reconciliation
  const requiresExternalTransactionId = (() => {
    if (!requiresPaymentChannel) return false;
    // If the target category is linked to any payment integration, external_transaction_id is required
    return toCategory?.isLinked === true;
  })();
  
  // Check if the selected category is linked to a payment integration
  const selectedCategory = categories.find((cat) => cat.id === selectedCategoryId);
  const isCategoryLinked = selectedCategory?.isLinked ?? false;
  
  // Get the external account (if exists)
  const externalAccount = externalAccountId ? accounts.find((acc) => acc.id === externalAccountId) : undefined;

  function handleCategoryChange(categoryId: string) {
    setSelectedCategoryId(categoryId);
    setSelectedAccountId(""); // Reset account filter when category changes
    router.push(`/dashboard/transactions?categoryId=${categoryId}`);
  }

  function handleAccountChange(accountId: string) {
    setSelectedAccountId(accountId);
  }

  // Fetch account balances using batch API (can be called on demand or preloaded)
  const fetchAccountBalances = useCallback(async () => {
    if (loadingBalances || balancesLoaded) return;
    if (accounts.length === 0) {
      setBalancesLoaded(true);
      return;
    }
    
    setLoadingBalances(true);
    try {
      // Use the batch balances API with fn::tb_accounts
      const accountIds = accounts.map((acc) => acc.id);
      const res = await fetch("/api/settings/balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountIds }),
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.balances) {
          const balances: Record<string, string> = {};
          // data.balances is a map of accountId -> TbAccount
          for (const [accountId, tbAccount] of Object.entries(data.balances)) {
            if (tbAccount && typeof tbAccount === "object") {
              const tb = tbAccount as { book_balance?: string };
              if (tb.book_balance) {
                balances[accountId] = tb.book_balance;
              }
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
  }, [loadingBalances, balancesLoaded, accounts]);

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
    // Set current date and time in local timezone
    const now = new Date();
    // Format date as YYYY-MM-DD in local timezone
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    setTransactionDate(`${year}-${month}-${day}`);
    setTransactionTime(now.toTimeString().slice(0, 5)); // Current time in HH:MM format
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
      // Combine date and time into ISO string
      let createdAt: string | undefined;
      if (transactionDate) {
        const timeToUse = transactionTime || "00:00";
        // Parse date and time in local timezone, then convert to ISO
        const localDateTime = new Date(`${transactionDate}T${timeToUse}:00`);
        createdAt = localDateTime.toISOString();
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

      // Build the request body based on transfer type
      type TransferRequestBody = {
        fromAccountId: string;
        toAccountId?: string;
        amount: number;
        type: TransferType;
        status: string;
        description?: string;
        label?: string;
        createdAt?: string;
        metadata?: Record<string, unknown>;
        externalTransactionId?: string;
        paymentChannel?: {
          channelId: string;
          toAccount: string;
          paymentIntegration?: string;
        };
      };
      
      const requestBody: TransferRequestBody = {
        fromAccountId,
        amount: numAmount,
        type: transferType,
        status: submitDraft ? "submitted" : "draft",
        description: description.trim() || undefined,
        label: label.trim() || undefined,
        createdAt,
        metadata,
        // Include externalTransactionId for: external account transfers OR cross-category transfers to linked categories
        externalTransactionId: (involvesExternalAccount || requiresExternalTransactionId) && externalTransactionId.trim() ? externalTransactionId.trim() : undefined,
      };
      
      // If transfer requires payment_channel (cross-category to linked category)
      if (requiresPaymentChannel && toAccountId) {
        // Use bagayi_inter_switch channel to route to external payment integration
        requestBody.paymentChannel = {
          channelId: "bagayi_inter_switch",
          toAccount: toAccountId,
        };
        
        // Add paymentIntegration if target category is linked
        if (requiresExternalTransactionId && toCategory) {
          // If target has b2c_paybill and user selected b2c, use b2c_paybill
          // Otherwise use main integration
          const integrationId = toCategory.hasB2cPaybill && selectedPaybillType === "b2c"
            ? toCategory.b2cPaybillId
            : toCategory.paymentIntegrationId;
          
          if (integrationId) {
            requestBody.paymentChannel.paymentIntegration = integrationId;
          }
        }
        // Don't set toAccountId when using payment_channel
      } else {
        requestBody.toAccountId = toAccountId;
      }

      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
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
            channelId: "MPESA",
            action: "BusinessBuyGoods",
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

  async function handlePaybillPayment() {
    if (!fromAccountId || !paybillNumber.trim() || !accountReference.trim() || !amount) {
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
          // No toAccountId for paybill
          amount: numAmount,
          type: transferType,
          status: submitDraft ? "submitted" : "draft",
          description: description.trim() || undefined,
          label: label.trim() || undefined,
          paymentChannel: {
            channelId: "MPESA",
            action: "BusinessPayBill",
            toAccount: paybillNumber.trim(),
            accountReference: accountReference.trim(),
          },
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && (data.reason || data.error)) || "Failed to create paybill payment");
        return;
      }

      closeModal();
      router.refresh();
    } catch {
      setError("Failed to create paybill payment");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSendMoney() {
    if (!fromAccountId || !phoneNumber.trim() || !amount) {
      setError("Please fill in all required fields");
      return;
    }

    // Validate Kenyan phone number format: must be 12 digits starting with 254
    const trimmedPhone = phoneNumber.trim();
    if (trimmedPhone.length !== 12) {
      setError("Phone number must be 12 digits (e.g., 254712345678)");
      return;
    }
    if (!trimmedPhone.startsWith("254")) {
      setError("Phone number must start with 254 (Kenya country code)");
      return;
    }
    // Check the digit after 254 - valid prefixes are 7XX, 1XX for Kenyan mobile numbers
    const afterCountryCode = trimmedPhone.substring(3);
    if (!/^[17]\d{8}$/.test(afterCountryCode)) {
      setError("Invalid Kenyan mobile number. Must be 254 followed by 7XXXXXXXX or 1XXXXXXXX");
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
            channelId: "MPESA",
            action: "BusinessPayment",
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
                  setPhoneNumber("254");
                  setAmount("");
                  setDisplayAmount("");
                  setTransferType("payment");
                  setDescription("");
                  setLabel("");
                  setSubmitDraft(true);
                  setError(null);
                  // Lazy-load account balances and frequent recipients
                  void fetchAccountBalances();
                  void fetchFrequentRecipients("BusinessPayment");
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
                  // Lazy-load account balances and frequent recipients
                  void fetchAccountBalances();
                  void fetchFrequentRecipients("BusinessBuyGoods");
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
              <button
                type="button"
                onClick={() => {
                  setShowTransactionMenu(false);
                  setModalMode("paybill");
                  setShowModal(true);
                  // If account filter is selected, pre-select it as From Account
                  setFromAccountId(selectedAccountId || "");
                  setPaybillNumber("");
                  setAccountReference("");
                  setAmount("");
                  setDisplayAmount("");
                  setTransferType("payment");
                  setDescription("");
                  setLabel("");
                  setSubmitDraft(true);
                  setError(null);
                  // Lazy-load account balances and frequent recipients
                  void fetchAccountBalances();
                  void fetchFrequentRecipients("BusinessPayBill");
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
                📋 Pay via Paybill
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

        {/* Selected Account Balance */}
        {selectedAccountId && (
          <div style={{ 
            flex: "1", 
            minWidth: "150px", 
            maxWidth: "200px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
          }}>
            <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
              Balance
            </label>
            <div style={{ 
              padding: "10px 12px",
              backgroundColor: "var(--bg-secondary, #f5f5f5)",
              borderRadius: "8px",
              fontFamily: "monospace",
              fontSize: "16px",
              fontWeight: 600,
              textAlign: "right",
            }}>
              {loadingBalances ? (
                <span
                  style={{
                    display: "inline-block",
                    width: "80px",
                    height: "18px",
                    backgroundColor: "var(--bg-hover, #e5e5e5)",
                    borderRadius: "4px",
                    animation: "pulse 1.5s ease-in-out infinite",
                  }}
                />
              ) : accountBalances[selectedAccountId] ? (
                formatBalance(accountBalances[selectedAccountId])
              ) : (
                "-"
              )}
            </div>
          </div>
        )}
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
              {selectedAccountId && <div className="table-amount">Balance</div>}
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
                {selectedAccountId && (
                  <div 
                    className="table-amount" 
                    data-label="Balance" 
                    style={{ 
                      fontFamily: "monospace", 
                      fontSize: "13px",
                      backgroundColor: (() => {
                        const balance = getTransferBalance(transfer, selectedAccountId);
                        if (balance !== null) {
                          const num = parseFloat(balance);
                          if (!isNaN(num)) {
                            return num >= 0 ? "#dcfce7" : "#fee2e2";
                          }
                        }
                        return "transparent";
                      })(),
                      color: (() => {
                        const balance = getTransferBalance(transfer, selectedAccountId);
                        if (balance !== null) {
                          const num = parseFloat(balance);
                          if (!isNaN(num)) {
                            return num >= 0 ? "#166534" : "#991b1b";
                          }
                        }
                        return "var(--text-secondary, #666)";
                      })(),
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontWeight: 600,
                    }}
                  >
                    {(() => {
                      const balance = getTransferBalance(transfer, selectedAccountId);
                      if (balance !== null) {
                        const num = parseFloat(balance);
                        if (!isNaN(num)) {
                          return formatNumber(num);
                        }
                      }
                      return "-";
                    })()}
                  </div>
                )}
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
                {modalMode === "buygoods" ? "Pay via Buy Goods" : modalMode === "sendmoney" ? "M-Pesa Send Money" : modalMode === "paybill" ? "Pay via Paybill" : "Record Transaction"}
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
                  {/* Show external account for categories that are NOT linked to a payment integration */}
                  {!isCategoryLinked && externalAccount && modalMode === "manual" && externalAccount.id !== toAccountId && (
                    <option key={externalAccount.id} value={externalAccount.id}>
                      {externalAccount.name} (External)
                    </option>
                  )}
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
                    {(() => {
                      // Build a set of valid destination account IDs
                      // For cross-category transfers, only default accounts of root categories are allowed
                      const defaultAccountIds = new Set(
                        categories
                          .filter((cat) => cat.defaultAccountId)
                          .map((cat) => cat.defaultAccountId!)
                      );
                      
                      return accounts
                        .filter((acc) => {
                          // Never show the from account
                          if (acc.id === fromAccountId) return false;
                          
                          // Always allow external account
                          if (externalAccountId && acc.id === externalAccountId) return true;
                          
                          // If no from account selected yet, show all
                          if (!fromCategory) return true;
                          
                          // Same category - always allowed
                          if (acc.categoryId === fromCategory.id) return true;
                          
                          // From a linked category - only same category accounts are allowed
                          // (cross-category uses mpesa payment channels, not bagayi_inter_switch)
                          if (fromCategory.isLinked) {
                            return acc.categoryId === fromCategory.id;
                          }
                          
                          // Cross-category from unlinked: only default accounts of root categories
                          return defaultAccountIds.has(acc.id);
                        })
                        .map((acc) => {
                          const isExternal = externalAccountId && acc.id === externalAccountId;
                          const balance = accountBalances[acc.id];
                          const isDefaultAccount = defaultAccountIds.has(acc.id);
                          const category = categories.find((cat) => cat.defaultAccountId === acc.id);
                          
                          return (
                            <option key={acc.id} value={acc.id}>
                              {isExternal 
                                ? acc.name 
                                : isDefaultAccount && category
                                  ? `${category.name} (Default)${balance ? ` - Balance: ${formatBalance(balance)}` : loadingBalances ? " (loading...)" : ""}`
                                  : `${acc.name} (${acc.categoryName})${balance ? ` - Balance: ${formatBalance(balance)}` : loadingBalances ? " (loading...)" : ""}`
                              }
                            </option>
                          );
                        });
                    })()}
                  </select>
                  {/* Show hint when cross-category transfer is detected */}
                  {requiresPaymentChannel && toAccountId && (
                    <div style={{ 
                      marginTop: "6px", 
                      padding: "8px 12px", 
                      backgroundColor: requiresExternalTransactionId ? "#fef3c7" : "#dbeafe", 
                      borderRadius: "6px",
                      fontSize: "12px",
                      color: requiresExternalTransactionId ? "#92400e" : "#1e40af"
                    }}>
                      {requiresExternalTransactionId 
                        ? "⚠️ This transfer is to an M-Pesa linked category. External Transaction ID is required for reconciliation."
                        : "ℹ️ This cross-category transfer will be routed via Bagayi InterSwitch"}
                    </div>
                  )}
                  
                  {/* External Transaction ID for cross-category transfers to linked categories */}
                  {requiresExternalTransactionId && (
                    <div style={{ marginTop: "12px" }}>
                      <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                        External Transaction ID *
                      </label>
                      <input
                        className="setup-input"
                        type="text"
                        value={externalTransactionId}
                        onChange={(e) => setExternalTransactionId(e.target.value)}
                        placeholder="e.g., M-Pesa receipt number, bank reference"
                        disabled={isBusy}
                        style={{ 
                          width: "100%",
                          maxWidth: "100%",
                          boxSizing: "border-box",
                          borderColor: !externalTransactionId.trim() ? "#f59e0b" : undefined
                        }}
                      />
                      <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                        Required for reconciliation with the linked payment integration
                      </div>
                    </div>
                  )}
                  
                  {/* Paybill Selection - Only show when target category has b2c_paybill */}
                  {requiresExternalTransactionId && toCategory?.hasB2cPaybill && (
                    <div style={{ marginTop: "12px" }}>
                      <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                        Payment Integration
                      </label>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <label style={{ 
                          display: "flex", 
                          alignItems: "center", 
                          padding: "10px 14px",
                          border: `2px solid ${selectedPaybillType === "main" ? "#22c55e" : "var(--border)"}`,
                          borderRadius: "8px",
                          cursor: "pointer",
                          backgroundColor: selectedPaybillType === "main" ? "#f0fdf4" : "transparent",
                          flex: 1,
                          minWidth: "140px",
                        }}>
                          <input
                            type="radio"
                            name="paybillType"
                            value="main"
                            checked={selectedPaybillType === "main"}
                            onChange={() => setSelectedPaybillType("main")}
                            disabled={isBusy}
                            style={{ marginRight: "8px" }}
                          />
                          <div>
                            <div style={{ fontWeight: 500, fontSize: "13px" }}>
                              {toCategory.paybillName || "Main Paybill"}
                            </div>
                            <div style={{ fontSize: "11px", color: "var(--text-secondary, #666)" }}>
                              Primary integration
                            </div>
                          </div>
                        </label>
                        <label style={{ 
                          display: "flex", 
                          alignItems: "center", 
                          padding: "10px 14px",
                          border: `2px solid ${selectedPaybillType === "b2c" ? "#22c55e" : "var(--border)"}`,
                          borderRadius: "8px",
                          cursor: "pointer",
                          backgroundColor: selectedPaybillType === "b2c" ? "#f0fdf4" : "transparent",
                          flex: 1,
                          minWidth: "140px",
                        }}>
                          <input
                            type="radio"
                            name="paybillType"
                            value="b2c"
                            checked={selectedPaybillType === "b2c"}
                            onChange={() => setSelectedPaybillType("b2c")}
                            disabled={isBusy}
                            style={{ marginRight: "8px" }}
                          />
                          <div>
                            <div style={{ fontWeight: 500, fontSize: "13px" }}>
                              {toCategory.b2cPaybillName || "B2C Paybill"}
                            </div>
                            <div style={{ fontSize: "11px", color: "var(--text-secondary, #666)" }}>
                              B2C integration
                            </div>
                          </div>
                        </label>
                      </div>
                      <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                        Select which payment integration to use for this transfer
                      </div>
                    </div>
                  )}
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
                  {/* Frequent Recipients */}
                  {frequentRecipients.length > 0 && (
                    <div style={{ marginTop: "12px" }}>
                      <div style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-secondary, #666)", marginBottom: "6px" }}>
                        Recent Merchants
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {frequentRecipients.map((r, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setBuyGoodsNumber(r.toAccount);
                              if (r.name) setLabel(r.name);
                            }}
                            disabled={isBusy}
                            style={{
                              padding: "6px 12px",
                              border: "1px solid var(--border)",
                              borderRadius: "16px",
                              backgroundColor: buyGoodsNumber === r.toAccount ? "#dcfce7" : "var(--bg-secondary, #f5f5f5)",
                              cursor: "pointer",
                              fontSize: "12px",
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                          >
                            <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{r.toAccount}</span>
                            {r.name && <span style={{ color: "var(--text-secondary, #666)" }}>· {r.name}</span>}
                            <span style={{ color: "#9ca3af", fontSize: "10px" }}>({r.count})</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {loadingFrequent && (
                    <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                      Loading recent merchants...
                    </div>
                  )}
                </div>
              ) : modalMode === "paybill" ? (
                <>
                  <div style={{ marginBottom: "16px" }}>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                      Paybill Number *
                    </label>
                    <input
                      className="setup-input"
                      type="text"
                      value={paybillNumber}
                      onChange={(e) => {
                        const value = e.target.value;
                        // Only allow digits
                        if (/^\d*$/.test(value)) {
                          setPaybillNumber(value);
                        }
                      }}
                      placeholder="e.g., 247247"
                      disabled={isBusy}
                      maxLength={10}
                      style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}
                    />
                    <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                      Enter the paybill number
                    </div>
                    {/* Frequent Recipients */}
                    {frequentRecipients.length > 0 && (
                      <div style={{ marginTop: "12px" }}>
                        <div style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-secondary, #666)", marginBottom: "6px" }}>
                          Recent Paybills
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {frequentRecipients.map((r, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setPaybillNumber(r.toAccount);
                                if (r.accountReference) setAccountReference(r.accountReference);
                                if (r.name) setLabel(r.name);
                              }}
                              disabled={isBusy}
                              style={{
                                padding: "6px 12px",
                                border: "1px solid var(--border)",
                                borderRadius: "16px",
                                backgroundColor: paybillNumber === r.toAccount && accountReference === (r.accountReference || "") ? "#dcfce7" : "var(--bg-secondary, #f5f5f5)",
                                cursor: "pointer",
                                fontSize: "12px",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                              }}
                            >
                              <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{r.toAccount}</span>
                              {r.accountReference && <span style={{ color: "#6366f1", fontSize: "11px" }}>#{r.accountReference}</span>}
                              {r.name && <span style={{ color: "var(--text-secondary, #666)" }}>· {r.name}</span>}
                              <span style={{ color: "#9ca3af", fontSize: "10px" }}>({r.count})</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {loadingFrequent && (
                      <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                        Loading recent paybills...
                      </div>
                    )}
                  </div>
                  <div style={{ marginBottom: "16px" }}>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                      Account Reference *
                    </label>
                    <input
                      className="setup-input"
                      type="text"
                      value={accountReference}
                      onChange={(e) => setAccountReference(e.target.value)}
                      placeholder="e.g., Invoice number, account number"
                      disabled={isBusy}
                      maxLength={50}
                      style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}
                    />
                    <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                      Enter the account reference for this payment
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                    Phone Number *
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      className="setup-input"
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => {
                        // Strip all non-digit characters (handles paste with spaces, dashes, +, etc.)
                        const value = e.target.value.replace(/\D/g, "");
                        setPhoneNumber(value.slice(0, 12));
                      }}
                      onPaste={(e) => {
                        e.preventDefault();
                        const pastedText = e.clipboardData.getData("text");
                        // Strip all non-digit characters from pasted content
                        const digits = pastedText.replace(/\D/g, "");
                        // If pasted number starts with 0, convert to 254 format
                        let cleanNumber = digits;
                        if (digits.startsWith("0") && digits.length >= 10) {
                          cleanNumber = "254" + digits.slice(1);
                        }
                        setPhoneNumber(cleanNumber.slice(0, 12));
                      }}
                      placeholder="e.g., 254712345678"
                      disabled={isBusy}
                      maxLength={12}
                      style={{ 
                        flex: 1,
                        maxWidth: "100%", 
                        boxSizing: "border-box",
                        borderColor: phoneNumber.length > 0 && (phoneNumber.length !== 12 || !phoneNumber.startsWith("254") || !/^[17]\d{8}$/.test(phoneNumber.substring(3))) ? "#f59e0b" : undefined
                      }}
                    />
                    {"contacts" in navigator && "ContactsManager" in window && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            // @ts-expect-error - Contact Picker API types not in standard TypeScript
                            const contacts = await navigator.contacts.select(
                              ["tel"],
                              { multiple: false }
                            );
                            if (contacts && contacts.length > 0 && contacts[0].tel && contacts[0].tel.length > 0) {
                              const tel = contacts[0].tel[0];
                              // Clean the phone number
                              const digits = tel.replace(/\D/g, "");
                              let cleanNumber = digits;
                              // Convert local format to international
                              if (digits.startsWith("0") && digits.length >= 10) {
                                cleanNumber = "254" + digits.slice(1);
                              }
                              // Remove leading country code duplicates (e.g., +254254...)
                              if (cleanNumber.startsWith("254254")) {
                                cleanNumber = cleanNumber.slice(3);
                              }
                              setPhoneNumber(cleanNumber.slice(0, 12));
                            }
                          } catch (err) {
                            // User cancelled or API not available
                            console.log("Contact picker cancelled or not available:", err);
                          }
                        }}
                        disabled={isBusy}
                        style={{
                          padding: "8px 12px",
                          border: "1px solid var(--border)",
                          borderRadius: "6px",
                          backgroundColor: "var(--bg-secondary, #f5f5f5)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          fontSize: "13px",
                          whiteSpace: "nowrap",
                        }}
                        title="Select from contacts"
                      >
                        📇
                        <span style={{ display: "none" }} className="contact-btn-text">Contacts</span>
                      </button>
                    )}
                  </div>
                  <div style={{ marginTop: "4px", fontSize: "12px", color: phoneNumber.length > 0 && (phoneNumber.length !== 12 || !phoneNumber.startsWith("254") || !/^[17]\d{8}$/.test(phoneNumber.substring(3))) ? "#f59e0b" : "var(--text-secondary, #666)" }}>
                    {phoneNumber.length === 0 
                      ? "Enter recipient's phone number (e.g., 254712345678)"
                      : phoneNumber.length !== 12 
                        ? `${12 - phoneNumber.length} more digit${12 - phoneNumber.length === 1 ? "" : "s"} needed`
                        : !phoneNumber.startsWith("254")
                          ? "Must start with 254 (Kenya country code)"
                          : !/^[17]\d{8}$/.test(phoneNumber.substring(3))
                            ? "Invalid format. After 254, must be 7XXXXXXXX or 1XXXXXXXX"
                            : "✓ Valid phone number"
                    }
                  </div>
                  {/* Frequent Recipients */}
                  {frequentRecipients.length > 0 && (
                    <div style={{ marginTop: "12px" }}>
                      <div style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-secondary, #666)", marginBottom: "6px" }}>
                        Recent Contacts
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {frequentRecipients.map((r, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setPhoneNumber(r.toAccount);
                              if (r.name) setLabel(r.name);
                            }}
                            disabled={isBusy}
                            style={{
                              padding: "6px 12px",
                              border: "1px solid var(--border)",
                              borderRadius: "16px",
                              backgroundColor: phoneNumber === r.toAccount ? "#dcfce7" : "var(--bg-secondary, #f5f5f5)",
                              cursor: "pointer",
                              fontSize: "12px",
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                          >
                            <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{r.toAccount}</span>
                            {r.name && <span style={{ color: "var(--text-secondary, #666)" }}>· {r.name}</span>}
                            <span style={{ color: "#9ca3af", fontSize: "10px" }}>({r.count})</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {loadingFrequent && (
                    <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                      Loading recent contacts...
                    </div>
                  )}
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
                    Transaction Date & Time
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      className="setup-input"
                      type="date"
                      value={transactionDate}
                      onChange={(e) => setTransactionDate(e.target.value)}
                      disabled={isBusy}
                      style={{ flex: 1, boxSizing: "border-box" }}
                    />
                    <input
                      className="setup-input"
                      type="time"
                      value={transactionTime}
                      onChange={(e) => setTransactionTime(e.target.value)}
                      disabled={isBusy}
                      style={{ width: "120px", boxSizing: "border-box" }}
                    />
                  </div>
                  <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                    When did this transaction occur? Defaults to current date and time.
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

              {/* Validation summary for Send Money */}
              {modalMode === "sendmoney" && (
                (() => {
                  const issues: string[] = [];
                  if (!fromAccountId) issues.push("Select a source account");
                  if (phoneNumber.length !== 12 || !phoneNumber.startsWith("254") || !/^[17]\d{8}$/.test(phoneNumber.substring(3))) {
                    issues.push("Enter a valid phone number");
                  }
                  if (!amount || parseFloat(amount) <= 0) issues.push("Enter an amount");
                  
                  if (issues.length > 0) {
                    return (
                      <div style={{ 
                        marginBottom: "12px", 
                        padding: "10px 12px", 
                        backgroundColor: "#fef3c7", 
                        borderRadius: "6px",
                        fontSize: "13px",
                        color: "#92400e"
                      }}>
                        <div style={{ fontWeight: 500, marginBottom: "4px" }}>To send money, please:</div>
                        <ul style={{ margin: 0, paddingLeft: "18px" }}>
                          {issues.map((issue, i) => (
                            <li key={i}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    );
                  }
                  return null;
                })()
              )}

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
                        : modalMode === "paybill"
                          ? handlePaybillPayment
                          : handleCreateTransfer
                  }
                  disabled={
                    isBusy ||
                    !fromAccountId ||
                    !amount ||
                    (modalMode === "manual" && !toAccountId) ||
                    (modalMode === "manual" && involvesExternalAccount && (!externalTransactionId.trim() || !extMetaId.trim() || !extMetaName.trim() || !extMetaType.trim())) ||
                    (modalMode === "manual" && requiresExternalTransactionId && !externalTransactionId.trim()) ||
                    (modalMode === "buygoods" && !buyGoodsNumber.trim()) ||
                    (modalMode === "paybill" && (!paybillNumber.trim() || !accountReference.trim())) ||
                    (modalMode === "sendmoney" && (phoneNumber.length !== 12 || !phoneNumber.startsWith("254") || !/^[17]\d{8}$/.test(phoneNumber.substring(3))))
                  }
                >
                  {isBusy
                    ? modalMode === "buygoods" || modalMode === "paybill"
                      ? "Processing…"
                      : modalMode === "sendmoney"
                        ? "Sending…"
                        : "Creating…"
                    : submitDraft
                      ? modalMode === "buygoods" || modalMode === "paybill"
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
