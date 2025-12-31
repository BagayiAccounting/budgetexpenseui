"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const TEMPLATE_CATEGORIES = ["Rent", "Shopping", "Salary", "Savings", "Entertainment"];

export default function SetupCategories() {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(TEMPLATE_CATEGORIES.map((c) => [c, true])),
  );
  const [custom, setCustom] = useState("");
  const [customList, setCustomList] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = useMemo(() => {
    const fromTemplate = TEMPLATE_CATEGORIES.filter((c) => selected[c]);
    return [...fromTemplate, ...customList];
  }, [customList, selected]);

  function addCustom() {
    const name = custom.trim();
    if (!name) return;
    if (customList.some((c) => c.toLowerCase() === name.toLowerCase())) {
      setCustom("");
      return;
    }
    setCustomList((prev) => [...prev, name]);
    setCustom("");
  }

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/setup/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data && (data.reason || data.error)) || "Failed to create categories");
        return;
      }

      // Best-effort: ensure the sidebar is visible after setup.
      try {
        window.localStorage.setItem("sidebarCollapsed", "false");
        window.localStorage.setItem("sidebarHidden", "false");
      } catch {
        // ignore
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Failed to create categories");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Setup</h1>
          <p className="dashboard-subtitle">Choose categories to get started.</p>
        </div>
      </header>

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Templates</div>
            <div className="panel-subtitle">Select what you want to use.</div>
          </div>
        </div>

        <div className="setup-list">
          {TEMPLATE_CATEGORIES.map((name) => (
            <label key={name} className="setup-item">
              <input
                type="checkbox"
                checked={!!selected[name]}
                onChange={(e) => setSelected((prev) => ({ ...prev, [name]: e.target.checked }))}
              />
              <span>{name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Add your own</div>
            <div className="panel-subtitle">Create custom categories (optional).</div>
          </div>
        </div>

        <div className="setup-add">
          <input
            className="setup-input"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="e.g. Utilities"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
          />
          <button type="button" className="button button-ghost" onClick={addCustom}>
            Add
          </button>
        </div>

        {customList.length > 0 && (
          <div className="setup-chips">
            {customList.map((c) => (
              <button
                key={c}
                type="button"
                className="setup-chip"
                onClick={() => setCustomList((prev) => prev.filter((x) => x !== c))}
                aria-label={`Remove ${c}`}
              >
                {c} ×
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="panel error-state">
          <div className="panel-title">Something went wrong</div>
          <div className="panel-subtitle">{error}</div>
        </div>
      )}

      <div className="setup-actions">
        <button
          type="button"
          className="button login"
          onClick={submit}
          disabled={loading || categories.length === 0}
        >
          {loading ? "Creating…" : "Create categories"}
        </button>
      </div>
    </div>
  );
}
