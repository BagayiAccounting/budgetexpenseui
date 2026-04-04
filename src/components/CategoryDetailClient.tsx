"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { TbAccount, AccountBalancesMap } from "@/lib/settingsService";
import { rowsFromTbAccount } from "@/lib/accountUtils";

const ACCOUNT_TYPES = ["asset", "expense", "liability", "revenue", "equity"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

type Category = {
  id: string;
  name: string;
  defaultAccountId?: string;
  accounts: Array<{ id: string; name: string; type?: string; tbAccount?: TbAccount }>;
  subcategories: Category[];
};

type ModalType = "account" | "subcategory" | "mpesa" | "link-mpesa" | "add-user" | "migrate-mpesa" | "rename-account" | null;

type CategoryUser = {
  id: string;
  categoryId: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  role: string;
};

type MpesaIntegration = {
  id: string;
  businessShortCode: string;
  paybillName: string;
  initiatorName?: string;
  hasSecurityCredential?: boolean;
  utilityAccount: string;
  workingAccount: string;
  unlinkedTransferInAccount: string;
  unlinkedTransferOutAccount: string;
  liabilityAccount: string;
  b2cPaybill?: string;
  status?: string;
};

export default function CategoryDetailClient({ category: initialCategory }: { category: Category }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<AccountBalancesMap>({});
  const [balancesLoading, setBalancesLoading] = useState(true);
  const [modalType, setModalType] = useState<ModalType>(null);
  const [modalCategoryId, setModalCategoryId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState<string | null>(null);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  
  // Form states
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("asset");
  const [subcategoryName, setSubcategoryName] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  // Collect all account IDs from the category tree
  const collectAccountIds = useCallback((cat: Category): string[] => {
    const ids: string[] = [];
    function traverse(c: Category) {
      for (const account of c.accounts) {
        ids.push(account.id);
      }
      for (const sub of c.subcategories) {
        traverse(sub);
      }
    }
    traverse(cat);
    return ids;
  }, []);

  // Merge balances into category
  const category = useMemo(() => {
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
    return enrichCategory(initialCategory);
  }, [initialCategory, balances]);

  // Fetch balances asynchronously on mount
  useEffect(() => {
    const accountIds = collectAccountIds(initialCategory);
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
          console.error("[CategoryDetailClient] Failed to fetch balances:", res.status);
          return;
        }

        const data = await res.json();
        if (!cancelled && data.balances) {
          setBalances(data.balances);
        }
      } catch (err) {
        console.error("[CategoryDetailClient] Error fetching balances:", err);
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
  }, [initialCategory, collectAccountIds]);
  
  // M-Pesa integration states - now supports multiple integrations per category
  const [mpesaIntegrations, setMpesaIntegrations] = useState<MpesaIntegration[]>([]);
  const [editingIntegration, setEditingIntegration] = useState<MpesaIntegration | null>(null);
  const [loadingMpesa, setLoadingMpesa] = useState(false);
  const [businessShortCode, setBusinessShortCode] = useState("");
  const [paybillName, setPaybillName] = useState("");
  const [initiatorName, setInitiatorName] = useState("");
  const [securityCredential, setSecurityCredential] = useState("");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  const [b2cPaybillId, setB2cPaybillId] = useState("");
  const [availablePaybills, setAvailablePaybills] = useState<Array<{ id: string; paybillName: string; businessShortCode: string; categoryId?: string }>>([]);
  const [shouldCreateAccounts, setShouldCreateAccounts] = useState(true);
  const [utilityAccountId, setUtilityAccountId] = useState("");
  const [workingAccountId, setWorkingAccountId] = useState("");
  const [unlinkedTransferInAccountId, setUnlinkedTransferInAccountId] = useState("");
  const [unlinkedTransferOutAccountId, setUnlinkedTransferOutAccountId] = useState("");
  const [liabilityAccountId, setLiabilityAccountId] = useState("");
  
  // M-Pesa link states
  const [availableMpesaIntegrations, setAvailableMpesaIntegrations] = useState<Array<{ id: string; paybillName: string; businessShortCode: string }>>([]);
  const [selectedMpesaIntegrationId, setSelectedMpesaIntegrationId] = useState("");
  const [mpesaLink, setMpesaLink] = useState<{ id: string; mpesaIntegrationId: string; linkId?: string } | null>(null);
  const [mpesaLinkId, setMpesaLinkId] = useState("");
  const [mpesaLinkDetails, setMpesaLinkDetails] = useState<{ paybillName: string; businessShortCode: string; linkId: string } | null>(null);

  // Category users states
  const [categoryUsers, setCategoryUsers] = useState<CategoryUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState<"viewer" | "editor" | "admin">("viewer");

  // Migration states
  const [migratingIntegration, setMigratingIntegration] = useState<MpesaIntegration | null>(null);
  const [availableCategories, setAvailableCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [targetCategoryId, setTargetCategoryId] = useState("");
  const [migrationConflicts, setMigrationConflicts] = useState<Array<{ id: string; currentName: string }>>([]);
  const [migrationAccounts, setMigrationAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [accountRenames, setAccountRenames] = useState<Record<string, string>>({});
  const [checkingMigration, setCheckingMigration] = useState(false);
  const [migrationHasB2c, setMigrationHasB2c] = useState(false);

  // Rename account states
  const [renamingAccount, setRenamingAccount] = useState<{ id: string; name: string } | null>(null);
  const [newAccountName, setNewAccountName] = useState("");

  // Function to load M-Pesa integrations (multiple per category)
  const loadMpesaIntegrations = async () => {
    setLoadingMpesa(true);
    try {
      const res = await fetch(`/api/settings/mpesa?categoryId=${encodeURIComponent(category.id)}`);
      if (res.ok) {
        const data = await res.json();
        setMpesaIntegrations(data.integrations || []);
      }
    } catch (err) {
      console.error("Failed to load M-Pesa integrations:", err);
    } finally {
      setLoadingMpesa(false);
    }
  };

  // Function to load M-Pesa link
  const loadMpesaLink = async () => {
    try {
      const res = await fetch(`/api/settings/category-mpesa-link?categoryId=${encodeURIComponent(category.id)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.links && data.links.length > 0) {
          setMpesaLink(data.links[0]);
        } else {
          setMpesaLink(null);
        }
      }
    } catch (err) {
      console.error("Failed to load M-Pesa link:", err);
    }
  };

  // Function to load available M-Pesa integrations
  const loadAvailableMpesaIntegrations = async () => {
    try {
      const res = await fetch("/api/settings/category-mpesa-link?listIntegrations=true");
      if (res.ok) {
        const data = await res.json();
        if (data.integrations) {
          setAvailableMpesaIntegrations(data.integrations);
        }
      }
    } catch (err) {
      console.error("Failed to load available M-Pesa integrations:", err);
    }
  };

  // Load category users
  const loadCategoryUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await fetch(`/api/settings/category-users?categoryId=${encodeURIComponent(category.id)}`);
      if (res.ok) {
        const data = await res.json();
        setCategoryUsers(data.categoryUsers || []);
      }
    } catch (err) {
      console.error("Failed to load category users:", err);
    } finally {
      setLoadingUsers(false);
    }
  };

  // Add user to category
  const handleAddUser = async () => {
    if (!newUserEmail.trim()) {
      setError("Please enter a user email");
      return;
    }

    setError(null);
    setIsBusy(true);

    try {
      const res = await fetch("/api/settings/category-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: category.id,
          userEmail: newUserEmail.trim(),
          role: newUserRole,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && data.error) || "Failed to add user");
        return;
      }

      closeModal();
      await loadCategoryUsers();
    } catch {
      setError("Failed to add user");
    } finally {
      setIsBusy(false);
    }
  };

  // Update user role
  const handleUpdateUserRole = async (categoryUserId: string, newRole: string) => {
    try {
      const res = await fetch("/api/settings/category-users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryUserId, role: newRole }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && data.error) || "Failed to update user role");
        return;
      }

      await loadCategoryUsers();
    } catch (err) {
      console.error("Failed to update user role:", err);
      setError("Failed to update user role");
    }
  };

  // Remove user from category
  const handleRemoveUser = async (categoryUserId: string) => {
    if (!confirm("Are you sure you want to remove this user from the category?")) {
      return;
    }

    try {
      const res = await fetch(`/api/settings/category-users?categoryUserId=${encodeURIComponent(categoryUserId)}`, {
        method: "DELETE",
      });

      if (res.ok) {
        await loadCategoryUsers();
      }
    } catch (err) {
      console.error("Failed to remove user:", err);
    }
  };

  // Load M-Pesa integrations and link on mount
  useEffect(() => {
    void loadMpesaIntegrations();
    void loadMpesaLink();
    void loadCategoryUsers();
  }, [category.id]);

  async function openModal(type: ModalType, categoryId: string, integrationToEdit?: MpesaIntegration | null) {
    setModalType(type);
    setModalCategoryId(categoryId);
    setAccountName("");
    setAccountType("asset");
    setSubcategoryName("");
    
    // If opening M-Pesa modal, load all available paybills first
    if (type === "mpesa") {
      try {
        const res = await fetch("/api/settings/mpesa?listAll=true");
        if (res.ok) {
          const data = await res.json();
          if (data.integrations) {
            setAvailablePaybills(data.integrations);
          }
        }
      } catch (err) {
        console.error("Failed to load available paybills:", err);
      }
      
      // Use the passed integration if available, otherwise check state
      const integration = integrationToEdit !== undefined ? integrationToEdit : editingIntegration;
      
      // If editing an existing integration, pre-fill the form
      if (integration) {
        setEditingIntegration(integration);
        setBusinessShortCode(integration.businessShortCode || "");
        setPaybillName(integration.paybillName || "");
        // Pre-fill initiatorName (returned from API)
        setInitiatorName(integration.initiatorName || "");
        // Security credential: show placeholder if exists, empty if new
        setSecurityCredential(integration.hasSecurityCredential ? "••••••••" : "");
        // Consumer credentials: show placeholder if editing (we assume they exist)
        setConsumerKey("•••••••••••••");
        setConsumerSecret("•••••••••••••");
        // B2C Paybill: pre-fill if exists
        setB2cPaybillId(integration.b2cPaybill || "");
        setShouldCreateAccounts(false); // When editing, don't create new accounts
        setUtilityAccountId(integration.utilityAccount || "");
        setWorkingAccountId(integration.workingAccount || "");
        setUnlinkedTransferInAccountId(integration.unlinkedTransferInAccount || "");
        setUnlinkedTransferOutAccountId(integration.unlinkedTransferOutAccount || "");
        setLiabilityAccountId(integration.liabilityAccount || "");
      } else {
        setEditingIntegration(null);
        setBusinessShortCode("");
        setPaybillName("");
        setInitiatorName("");
        setSecurityCredential("");
        setConsumerKey("");
        setConsumerSecret("");
        setB2cPaybillId("");
        setShouldCreateAccounts(true);
        setUtilityAccountId("");
        setWorkingAccountId("");
        setUnlinkedTransferInAccountId("");
        setUnlinkedTransferOutAccountId("");
        setLiabilityAccountId("");
      }
    }
    
    setError(null);
    setShowDropdown(null);
  }

  function closeModal() {
    setModalType(null);
    setModalCategoryId(null);
    setAccountName("");
    setSubcategoryName("");
    setEditingIntegration(null);
    setMigratingIntegration(null);
    setTargetCategoryId("");
    setMigrationConflicts([]);
    setMigrationAccounts([]);
    setAccountRenames({});
    setMigrationHasB2c(false);
    setRenamingAccount(null);
    setNewAccountName("");
  }

  // Rename account handler
  const handleRenameAccount = async () => {
    if (!renamingAccount || !newAccountName.trim()) return;

    setError(null);
    setIsBusy(true);

    try {
      const res = await fetch("/api/settings/accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: renamingAccount.id,
          name: newAccountName.trim(),
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && (data.reason || data.error)) || "Failed to rename account");
        return;
      }

      closeModal();
      router.refresh();
    } catch {
      setError("Failed to rename account");
    } finally {
      setIsBusy(false);
    }
  };

  // Load available categories for migration
  const loadAvailableCategories = async () => {
    try {
      const res = await fetch("/api/settings/categories");
      if (res.ok) {
        const data = await res.json();
        if (data.categories) {
          // Flatten the category tree and filter out current category
          const flattenCategories = (cats: Array<{ id: string; name: string; subcategories?: Array<{ id: string; name: string }> }>, prefix = ""): Array<{ id: string; name: string }> => {
            const result: Array<{ id: string; name: string }> = [];
            for (const cat of cats) {
              const displayName = prefix ? `${prefix} > ${cat.name}` : cat.name;
              if (cat.id !== category.id) {
                result.push({ id: cat.id, name: displayName });
              }
              if (cat.subcategories && cat.subcategories.length > 0) {
                result.push(...flattenCategories(cat.subcategories as Array<{ id: string; name: string; subcategories?: Array<{ id: string; name: string }> }>, displayName));
              }
            }
            return result;
          };
          setAvailableCategories(flattenCategories(data.categories));
        }
      }
    } catch (err) {
      console.error("Failed to load categories:", err);
    }
  };

  // Check migration conflicts
  const checkMigrationConflicts = async () => {
    if (!migratingIntegration || !targetCategoryId) return;

    setCheckingMigration(true);
    setError(null);

    try {
      const res = await fetch("/api/settings/mpesa/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          integrationId: migratingIntegration.id,
          targetCategoryId,
          checkOnly: true,
        }),
      });

      const data = await res.json();

      if (data.accounts) {
        setMigrationAccounts(data.accounts);
      }

      if (data.hasB2cPaybill) {
        setMigrationHasB2c(true);
      } else {
        setMigrationHasB2c(false);
      }

      if (data.hasConflicts && data.conflicts) {
        setMigrationConflicts(data.conflicts);
        // Pre-fill renames with current names
        const renames: Record<string, string> = {};
        for (const conflict of data.conflicts) {
          renames[conflict.id] = conflict.currentName;
        }
        setAccountRenames(renames);
      } else {
        setMigrationConflicts([]);
        setAccountRenames({});
      }
    } catch (err) {
      console.error("Failed to check migration:", err);
      setError("Failed to check migration conflicts");
    } finally {
      setCheckingMigration(false);
    }
  };

  // Perform migration
  const handleMigrate = async () => {
    if (!migratingIntegration || !targetCategoryId) return;

    setError(null);
    setIsBusy(true);

    try {
      const res = await fetch("/api/settings/mpesa/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          integrationId: migratingIntegration.id,
          targetCategoryId,
          accountRenames: Object.keys(accountRenames).length > 0 ? accountRenames : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.hasConflicts) {
          setMigrationConflicts(data.conflicts);
          setError("Please resolve account name conflicts before migrating");
        } else {
          setError(data.error || "Failed to migrate integration");
        }
        return;
      }

      closeModal();
      await loadMpesaIntegrations();
      router.refresh();
    } catch (err) {
      console.error("Failed to migrate:", err);
      setError("Failed to migrate integration");
    } finally {
      setIsBusy(false);
    }
  };

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
          <div className="txn-left" style={{ flex: 1 }}>
            <div className="txn-name">{a.name}</div>
            <div className="txn-meta">{a.id}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
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
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                router.push(`/dashboard/transactions?categoryId=${encodeURIComponent(cat.id)}&accountId=${encodeURIComponent(a.id)}`);
              }}
              style={{ padding: "4px 8px", fontSize: "12px" }}
              title="Make a transaction with this account"
            >
              💸
            </button>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                setRenamingAccount({ id: a.id, name: a.name });
                setNewAccountName(a.name);
                setModalType("rename-account");
                setError(null);
              }}
              style={{ padding: "4px 8px", fontSize: "12px" }}
              title="Rename account"
            >
              ✏️
            </button>
          </div>
        </div>
      );
    });
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

        <div className="txn-list">{renderAccounts(subcat.accounts, subcat)}</div>

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>
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
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setShowHeaderMenu(!showHeaderMenu)}
              aria-label="Options"
              style={{ padding: "8px" }}
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
            {showHeaderMenu && (
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
                  onClick={() => {
                    setShowHeaderMenu(false);
                    openModal("mpesa", category.id, null);
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
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  Add M-Pesa Integration
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setShowHeaderMenu(false);
                    await loadAvailableMpesaIntegrations();
                    openModal("link-mpesa", category.id);
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
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  {mpesaLink ? "Change M-Pesa Link" : "Link to M-Pesa Integration"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowHeaderMenu(false);
                    setNewUserEmail("");
                    setNewUserRole("viewer");
                    openModal("add-user", category.id);
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
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  👥 Manage Users
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="panel error-state">
          <div className="panel-title">Something went wrong</div>
          <div className="panel-subtitle">{error}</div>
        </div>
      )}

      {/* M-Pesa Integrations Section - Show all integrations */}
      {mpesaIntegrations.length > 0 && !loadingMpesa && (
        <div className="panel">
          <div className="panel-header">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <div>
                <div className="panel-title">M-Pesa Integrations</div>
                <div className="panel-subtitle">{mpesaIntegrations.length} paybill configuration{mpesaIntegrations.length !== 1 ? "s" : ""}</div>
              </div>
              <button
                type="button"
                className="button button-ghost"
                onClick={() => {
                  openModal("mpesa", category.id, null);
                }}
                aria-label="Add M-Pesa integration"
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
            {mpesaIntegrations.map((integration) => (
              <div key={integration.id} className="txn-row">
                <div className="txn-left" style={{ cursor: "pointer" }} onClick={() => {
                  openModal("mpesa", category.id, integration);
                }}>
                  <div className="txn-name">{integration.paybillName}</div>
                  <div className="txn-meta">Business Short Code: {integration.businessShortCode}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {integration.status && (
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: "12px",
                        fontSize: "11px",
                        fontWeight: 500,
                        backgroundColor: integration.status === "active"
                          ? "var(--bg-success, #e8f5e9)"
                          : integration.status === "initializing"
                          ? "var(--bg-warning, #fff3e0)"
                          : integration.status === "initialization_failed"
                          ? "var(--bg-error, #ffebee)"
                          : "var(--bg-secondary, #f5f5f5)",
                        color: integration.status === "active"
                          ? "var(--text-success, #2e7d32)"
                          : integration.status === "initializing"
                          ? "var(--text-warning, #e65100)"
                          : integration.status === "initialization_failed"
                          ? "var(--text-error, #c62828)"
                          : "var(--text-secondary, #666)",
                      }}
                    >
                      {integration.status === "active"
                        ? "Active"
                        : integration.status === "initializing"
                        ? "Initializing..."
                        : integration.status === "initialization_failed"
                        ? "Failed"
                        : integration.status === "inactive"
                        ? "Inactive"
                        : integration.status}
                    </span>
                  )}
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={async (e) => {
                      e.stopPropagation();
                      setMigratingIntegration(integration);
                      await loadAvailableCategories();
                      setModalType("migrate-mpesa");
                    }}
                    style={{ padding: "4px 8px", fontSize: "12px" }}
                    title="Migrate to another category"
                  >
                    Migrate
                  </button>
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      openModal("mpesa", category.id, integration);
                    }}
                    style={{ padding: "4px 8px", fontSize: "12px" }}
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* M-Pesa Link Section - Show if link exists */}
      {mpesaLink && (
        <div className="panel">
          <div className="panel-header">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <div>
                <div className="panel-title">M-Pesa Payment Link</div>
                <div className="panel-subtitle">Linked to paybill integration</div>
              </div>
              <div style={{ position: "relative", display: "inline-block" }}>
                <button
                  type="button"
                  className="button button-ghost"
                  disabled
                  style={{ padding: "8px 12px", opacity: 0.5, cursor: "not-allowed" }}
                  title="Coming Soon"
                >
                  Change
                </button>
                <span style={{ 
                  position: "absolute", 
                  top: "-24px", 
                  right: "0", 
                  backgroundColor: "var(--bg-secondary, #f5f5f5)", 
                  padding: "2px 8px", 
                  borderRadius: "4px", 
                  fontSize: "10px", 
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  color: "var(--text-secondary, #666)"
                }}>
                  Coming Soon
                </span>
              </div>
            </div>
          </div>
          <div className="txn-list">
            <div className="txn-row">
              <div className="txn-left">
                <div className="txn-name">Link ID: {mpesaLink.linkId || "N/A"}</div>
                <div className="txn-meta">Integration ID: {mpesaLink.mpesaIntegrationId}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ padding: "4px 12px", backgroundColor: "var(--bg-success, #e8f5e9)", color: "var(--text-success, #2e7d32)", borderRadius: "12px", fontSize: "12px", fontWeight: 500 }}>
                  Linked
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Category Users Section */}
      <div className="panel">
        <div className="panel-header">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            <div>
              <div className="panel-title">👥 Users</div>
              <div className="panel-subtitle">
                {loadingUsers ? "Loading..." : `${categoryUsers.length} user${categoryUsers.length !== 1 ? "s" : ""} assigned`}
              </div>
            </div>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => {
                setNewUserEmail("");
                setNewUserRole("viewer");
                openModal("add-user", category.id);
              }}
              aria-label="Add user"
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
          {categoryUsers.length === 0 ? (
            <div className="txn-row">
              <div className="txn-left">
                <div className="txn-name">No users assigned</div>
                <div className="txn-meta">Click + to add users to this category</div>
              </div>
            </div>
          ) : (
            categoryUsers.map((cu) => (
              <div key={cu.id} className="txn-row">
                <div className="txn-left">
                  <div className="txn-name">{cu.userName || cu.userEmail || "Unknown User"}</div>
                  <div className="txn-meta">{cu.userEmail}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <select
                    className="setup-input"
                    value={cu.role}
                    onChange={(e) => handleUpdateUserRole(cu.id, e.target.value)}
                    style={{ padding: "4px 8px", fontSize: "12px", minWidth: "90px" }}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={() => handleRemoveUser(cu.id)}
                    style={{ padding: "4px 8px", color: "var(--text-error, #c62828)" }}
                    title="Remove user"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
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

        <div className="txn-list">{renderAccounts(category.accounts, category)}</div>
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
              <div className="panel-title">{editingIntegration ? "Edit M-Pesa Integration" : "Add M-Pesa Integration"}</div>
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
                  Business Short Code *
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

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  Initiator Name *
                </label>
                <input
                  className="setup-input"
                  value={initiatorName}
                  onChange={(e) => setInitiatorName(e.target.value)}
                  placeholder="e.g., apiuser"
                  disabled={isBusy}
                  style={{ width: "100%" }}
                />
                <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                  The name of the initiator to initiate the transaction
                </div>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  Security Credential *
                </label>
                <input
                  className="setup-input"
                  type="password"
                  value={securityCredential}
                  onChange={(e) => setSecurityCredential(e.target.value)}
                  placeholder="Enter security credential"
                  disabled={isBusy}
                  style={{ width: "100%" }}
                />
                <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                  Base64 encoded security credential from M-Pesa portal
                </div>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  Consumer Key *
                </label>
                <input
                  className="setup-input"
                  type="password"
                  value={consumerKey}
                  onChange={(e) => setConsumerKey(e.target.value)}
                  placeholder="Enter consumer key"
                  disabled={isBusy}
                  style={{ width: "100%" }}
                />
                <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                  Consumer key from M-Pesa Daraja portal
                </div>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  Consumer Secret *
                </label>
                <input
                  className="setup-input"
                  type="password"
                  value={consumerSecret}
                  onChange={(e) => setConsumerSecret(e.target.value)}
                  placeholder="Enter consumer secret"
                  disabled={isBusy}
                  style={{ width: "100%" }}
                />
                <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                  Consumer secret from M-Pesa Daraja portal
                </div>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  B2C Paybill (Optional)
                </label>
                <select
                  className="setup-input"
                  value={b2cPaybillId}
                  onChange={(e) => setB2cPaybillId(e.target.value)}
                  disabled={isBusy}
                  style={{ width: "100%" }}
                >
                  <option value="">None - Use this paybill for B2C</option>
                  {availablePaybills
                    .filter((p) => p.id !== editingIntegration?.id && p.categoryId === category.id)
                    .map((paybill) => (
                      <option key={paybill.id} value={paybill.id}>
                        {paybill.paybillName} ({paybill.businessShortCode})
                      </option>
                    ))}
                </select>
                <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                  Select a separate paybill for B2C transactions. Only paybills from the same category are shown.
                </div>
              </div>

              {/* Only show account creation option when creating new integration */}
              {!editingIntegration && (
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
                      Creates five accounts: Utility, Working, Unlinked Transfer In, Unlinked Transfer Out, and Liability
                    </div>
                  </div>
                </div>
              )}

              {(!shouldCreateAccounts || editingIntegration) && (
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ marginBottom: "12px", padding: "12px", backgroundColor: "var(--bg-info, #e3f2fd)", borderRadius: "8px", fontSize: "13px" }}>
                    Select existing accounts for M-Pesa integration. All five accounts are required.
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
                      Unlinked Transfer In Account
                    </label>
                    <select
                      className="setup-input"
                      value={unlinkedTransferInAccountId}
                      onChange={(e) => setUnlinkedTransferInAccountId(e.target.value)}
                      disabled={isBusy}
                      style={{ width: "100%" }}
                    >
                      <option value="">Select an account</option>
                      {category.accounts.filter((acc) => acc.type === "liability").map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ marginBottom: "12px" }}>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                      Unlinked Transfer Out Account
                    </label>
                    <select
                      className="setup-input"
                      value={unlinkedTransferOutAccountId}
                      onChange={(e) => setUnlinkedTransferOutAccountId(e.target.value)}
                      disabled={isBusy}
                      style={{ width: "100%" }}
                    >
                      <option value="">Select an account</option>
                      {category.accounts.filter((acc) => acc.type === "liability").map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ marginBottom: "12px" }}>
                    <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                      Liability Account
                    </label>
                    <select
                      className="setup-input"
                      value={liabilityAccountId}
                      onChange={(e) => setLiabilityAccountId(e.target.value)}
                      disabled={isBusy}
                      style={{ width: "100%" }}
                    >
                      <option value="">Select an account</option>
                      {category.accounts.filter((acc) => acc.type === "liability").map((acc) => (
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
                    // Check if credentials are placeholders (unchanged)
                    const isSecurityCredentialPlaceholder = securityCredential === "••••••••";
                    const isConsumerKeyPlaceholder = consumerKey === "•••••••••••••";
                    const isConsumerSecretPlaceholder = consumerSecret === "•••••••••••••";
                    
                    if (!modalCategoryId || !businessShortCode.trim() || !paybillName.trim() || !initiatorName.trim()) {
                      setError("Please fill in all required fields (Business Short Code, Paybill Name, Initiator Name)");
                      return;
                    }
                    
                    // Validate credentials - required if not placeholders
                    if (!isSecurityCredentialPlaceholder && !securityCredential.trim()) {
                      setError("Security Credential is required");
                      return;
                    }
                    
                    if (!isConsumerKeyPlaceholder && !consumerKey.trim()) {
                      setError("Consumer Key is required");
                      return;
                    }
                    
                    if (!isConsumerSecretPlaceholder && !consumerSecret.trim()) {
                      setError("Consumer Secret is required");
                      return;
                    }

                    if (!shouldCreateAccounts && (!utilityAccountId || !workingAccountId || !unlinkedTransferInAccountId || !unlinkedTransferOutAccountId || !liabilityAccountId)) {
                      setError("Please select all five accounts");
                      return;
                    }

                    setError(null);
                    setIsBusy(true);

                    try {
                      const body = {
                        categoryId: modalCategoryId,
                        businessShortCode: businessShortCode.trim(),
                        paybillName: paybillName.trim(),
                        initiatorName: initiatorName.trim(),
                        securityCredential: securityCredential.trim(),
                        consumerKey: consumerKey.trim(),
                        consumerSecret: consumerSecret.trim(),
                        b2cPaybillId: b2cPaybillId || undefined,
                        createAccounts: shouldCreateAccounts,
                        ...(shouldCreateAccounts ? {} : {
                          utilityAccountId,
                          workingAccountId,
                          unlinkedTransferInAccountId,
                          unlinkedTransferOutAccountId,
                          liabilityAccountId,
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
                      // Reload M-Pesa integrations immediately
                      await loadMpesaIntegrations();
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

      {/* Modal for linking to M-Pesa Integration */}
      {modalType === "link-mpesa" && (
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
              <div className="panel-title">Link to M-Pesa Integration</div>
            </div>
            <div style={{ padding: "20px", backgroundColor: "var(--bg-primary, #ffffff)" }}>
              {mpesaLink && (
                <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "var(--bg-info, #e3f2fd)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "13px", marginBottom: "4px" }}>
                    Current link will be replaced
                  </div>
                </div>
              )}

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  Select M-Pesa Integration
                </label>
                {availableMpesaIntegrations.length === 0 ? (
                  <div style={{ padding: "12px", backgroundColor: "var(--bg-secondary, #f5f5f5)", borderRadius: "8px", fontSize: "14px" }}>
                    No M-Pesa integrations available. Create one first.
                  </div>
                ) : (
                  <select
                    className="setup-input"
                    value={selectedMpesaIntegrationId}
                    onChange={(e) => setSelectedMpesaIntegrationId(e.target.value)}
                    disabled={isBusy}
                    style={{ width: "100%" }}
                  >
                    <option value="">Select an integration</option>
                    {availableMpesaIntegrations.map((integration) => (
                      <option key={integration.id} value={integration.id}>
                        {integration.paybillName} ({integration.businessShortCode})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  Link ID (for M-Pesa payments)
                </label>
                <input
                  className="setup-input"
                  value={mpesaLinkId}
                  onChange={(e) => {
                    const value = e.target.value;
                    // Only allow alphanumeric characters
                    if (/^[a-zA-Z0-9]*$/.test(value)) {
                      setMpesaLinkId(value.slice(0, 13));
                    }
                  }}
                  placeholder="e.g., ACC001 or RENT2024"
                  disabled={isBusy}
                  maxLength={13}
                  style={{ width: "100%" }}
                />
                <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                  Alphanumeric only, max 13 characters. Used when paying via M-Pesa.
                </div>
              </div>

              {error && (
                <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "var(--bg-error, #ffebee)", borderRadius: "8px", fontSize: "14px", color: "var(--text-error, #c62828)" }}>
                  {error}
                </div>
              )}

              <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                <button type="button" className="button button-ghost" onClick={closeModal} disabled={isBusy}>
                  Cancel
                </button>
                {mpesaLink && (
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={async () => {
                      setError(null);
                      setIsBusy(true);

                      try {
                        const res = await fetch(`/api/settings/category-mpesa-link?categoryId=${encodeURIComponent(category.id)}`, {
                          method: "DELETE",
                        });

                        if (!res.ok) {
                          const data = await res.json().catch(() => null);
                          setError((data && data.error) || "Failed to remove link");
                          return;
                        }

                        closeModal();
                        await loadMpesaLink();
                        router.refresh();
                      } catch {
                        setError("Failed to remove link");
                      } finally {
                        setIsBusy(false);
                      }
                    }}
                    disabled={isBusy}
                    style={{ color: "var(--text-error, #c62828)" }}
                  >
                    {isBusy ? "Removing…" : "Remove Link"}
                  </button>
                )}
                <button
                  type="button"
                  className="button"
                  onClick={async () => {
                    if (!selectedMpesaIntegrationId) {
                      setError("Please select an M-Pesa integration");
                      return;
                    }

                    if (!mpesaLinkId.trim()) {
                      setError("Please enter a Link ID");
                      return;
                    }

                    setError(null);
                    setIsBusy(true);

                    try {
                      // If there's an existing link, delete it first
                      if (mpesaLink) {
                        const deleteRes = await fetch(`/api/settings/category-mpesa-link?categoryId=${encodeURIComponent(category.id)}`, {
                          method: "DELETE",
                        });

                        if (!deleteRes.ok) {
                          setError("Failed to remove existing link");
                          return;
                        }
                      }

                      // Create new link
                      const res = await fetch("/api/settings/category-mpesa-link", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          categoryId: category.id,
                          mpesaIntegrationId: selectedMpesaIntegrationId,
                          linkId: mpesaLinkId.trim(),
                        }),
                      });

                      const data = await res.json().catch(() => null);
                      if (!res.ok) {
                        const errorMessage = data?.details || data?.error || "Failed to create link";
                        setError(errorMessage);
                        return;
                      }

                      closeModal();
                      await loadMpesaLink();
                      router.refresh();
                    } catch {
                      setError("Failed to create link");
                    } finally {
                      setIsBusy(false);
                    }
                  }}
                  disabled={isBusy || !selectedMpesaIntegrationId || !mpesaLinkId.trim() || availableMpesaIntegrations.length === 0}
                >
                  {isBusy ? "Linking…" : "Link Integration"}
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

      {/* Modal for migrating M-Pesa integration */}
      {modalType === "migrate-mpesa" && migratingIntegration && (
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
            style={{ width: "90%", maxWidth: "600px", margin: "20px", backgroundColor: "var(--bg-primary, #ffffff)", maxHeight: "90vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <div className="panel-title">Migrate M-Pesa Integration</div>
            </div>
            <div style={{ padding: "20px", backgroundColor: "var(--bg-primary, #ffffff)" }}>
              <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "var(--bg-info, #e3f2fd)", borderRadius: "8px" }}>
                <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "4px" }}>
                  Moving: {migratingIntegration.paybillName}
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                  Business Short Code: {migratingIntegration.businessShortCode}
                </div>
                {migratingIntegration.b2cPaybill && (
                  <div style={{ fontSize: "12px", color: "var(--text-secondary, #666)", marginTop: "4px" }}>
                    ⚠️ This integration has a linked B2C paybill that will also be migrated
                  </div>
                )}
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  Target Category *
                </label>
                {availableCategories.length === 0 ? (
                  <div style={{ padding: "12px", backgroundColor: "var(--bg-secondary, #f5f5f5)", borderRadius: "8px", fontSize: "14px" }}>
                    No other categories available for migration.
                  </div>
                ) : (
                  <select
                    className="setup-input"
                    value={targetCategoryId}
                    onChange={(e) => {
                      setTargetCategoryId(e.target.value);
                      setMigrationConflicts([]);
                      setMigrationAccounts([]);
                      setAccountRenames({});
                    }}
                    disabled={isBusy || checkingMigration}
                    style={{ width: "100%" }}
                  >
                    <option value="">Select a category</option>
                    {availableCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {targetCategoryId && !checkingMigration && migrationAccounts.length === 0 && (
                <div style={{ marginBottom: "16px" }}>
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={checkMigrationConflicts}
                    disabled={isBusy}
                    style={{ width: "100%" }}
                  >
                    Check for Conflicts
                  </button>
                </div>
              )}

              {checkingMigration && (
                <div style={{ marginBottom: "16px", textAlign: "center", color: "var(--text-secondary, #666)" }}>
                  Checking for conflicts...
                </div>
              )}

              {migrationAccounts.length > 0 && (
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontSize: "14px", fontWeight: 500, marginBottom: "8px" }}>
                    Accounts to Migrate ({migrationAccounts.length})
                    {migrationHasB2c && (
                      <span style={{ fontSize: "12px", fontWeight: 400, marginLeft: "8px", color: "var(--text-secondary, #666)" }}>
                        (includes B2C accounts)
                      </span>
                    )}
                  </div>
                  <div style={{ backgroundColor: "var(--bg-secondary, #f5f5f5)", borderRadius: "8px", padding: "12px" }}>
                    {migrationAccounts.map((account) => {
                      const hasConflict = migrationConflicts.some((c) => c.id === account.id);
                      return (
                        <div key={account.id} style={{ marginBottom: hasConflict ? "12px" : "8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: "13px" }}>{account.name}</span>
                            {hasConflict && (
                              <span style={{ fontSize: "11px", padding: "2px 6px", backgroundColor: "var(--bg-warning, #fff3e0)", color: "var(--text-warning, #e65100)", borderRadius: "4px" }}>
                                Name conflict
                              </span>
                            )}
                          </div>
                          {hasConflict && (
                            <div style={{ marginTop: "8px" }}>
                              <input
                                className="setup-input"
                                value={accountRenames[account.id] || ""}
                                onChange={(e) => setAccountRenames({ ...accountRenames, [account.id]: e.target.value })}
                                placeholder="Enter new name for this account"
                                disabled={isBusy}
                                style={{ width: "100%", fontSize: "13px" }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {migrationConflicts.length > 0 && (
                    <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--text-warning, #e65100)" }}>
                      ⚠️ {migrationConflicts.length} account{migrationConflicts.length !== 1 ? "s have" : " has"} name conflicts. Please provide unique names above.
                    </div>
                  )}
                  {migrationConflicts.length === 0 && (
                    <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--text-success, #2e7d32)" }}>
                      ✓ No conflicts detected. Ready to migrate.
                    </div>
                  )}
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
                  onClick={handleMigrate}
                  disabled={
                    isBusy ||
                    !targetCategoryId ||
                    availableCategories.length === 0 ||
                    migrationAccounts.length === 0 ||
                    (migrationConflicts.length > 0 && migrationConflicts.some((c) => !accountRenames[c.id]?.trim()))
                  }
                >
                  {isBusy ? "Migrating…" : "Migrate Integration"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal for renaming account */}
      {modalType === "rename-account" && renamingAccount && (
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
              <div className="panel-title">Rename Account</div>
            </div>
            <div style={{ padding: "20px", backgroundColor: "var(--bg-primary, #ffffff)" }}>
              <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "var(--bg-info, #e3f2fd)", borderRadius: "8px", fontSize: "13px" }}>
                Current name: <strong>{renamingAccount.name}</strong>
              </div>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  New Account Name *
                </label>
                <input
                  className="setup-input"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  placeholder="Enter new account name"
                  disabled={isBusy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleRenameAccount();
                    }
                  }}
                  style={{ width: "100%" }}
                  autoFocus
                />
              </div>

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
                  onClick={handleRenameAccount}
                  disabled={isBusy || !newAccountName.trim() || newAccountName.trim() === renamingAccount.name}
                >
                  {isBusy ? "Renaming…" : "Rename Account"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal for adding user to category */}
      {modalType === "add-user" && (
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
              <div className="panel-title">Add User to Category</div>
            </div>
            <div style={{ padding: "20px", backgroundColor: "var(--bg-primary, #ffffff)" }}>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  User Email *
                </label>
                <input
                  className="setup-input"
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="Enter user's email address"
                  disabled={isBusy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAddUser();
                    }
                  }}
                  style={{ width: "100%" }}
                  autoFocus
                />
                <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-secondary, #666)" }}>
                  The user must already have an account in the system
                </div>
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontSize: "14px", fontWeight: 500 }}>
                  Role *
                </label>
                <select
                  className="setup-input"
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as "viewer" | "editor" | "admin")}
                  disabled={isBusy}
                  style={{ width: "100%" }}
                >
                  <option value="viewer">Viewer - Can view category data</option>
                  <option value="editor">Editor - Can view and edit data</option>
                  <option value="admin">Admin - Full access including user management</option>
                </select>
              </div>

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
                  onClick={handleAddUser}
                  disabled={isBusy || !newUserEmail.trim()}
                >
                  {isBusy ? "Adding…" : "Add User"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
