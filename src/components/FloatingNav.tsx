"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import ThemeToggle from "@/components/ThemeToggle";
import { useEffect, useMemo, useRef, useState } from "react";

const navItems = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/transactions", label: "Transactions" },
];

const STORAGE_WIDTH_KEY = "sidebarWidth";
const STORAGE_COLLAPSED_KEY = "sidebarCollapsed";
const STORAGE_HIDDEN_KEY = "sidebarHidden";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 420;
const COLLAPSED_WIDTH = 72;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function FloatingNav() {
  const pathname = usePathname();
  const { user } = useUser();

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const dragStartXRef = useRef<number | null>(null);
  const dragStartWidthRef = useRef<number>(DEFAULT_WIDTH);

  const effectiveWidth = useMemo(
    () => (collapsed ? COLLAPSED_WIDTH : width),
    [collapsed, width],
  );

  useEffect(() => {
    try {
      const savedWidthRaw = window.localStorage.getItem(STORAGE_WIDTH_KEY);
      const savedCollapsedRaw = window.localStorage.getItem(STORAGE_COLLAPSED_KEY);
      const savedHiddenRaw = window.localStorage.getItem(STORAGE_HIDDEN_KEY);

      const savedWidth = savedWidthRaw ? Number(savedWidthRaw) : NaN;
      if (Number.isFinite(savedWidth)) {
        setWidth(clamp(savedWidth, MIN_WIDTH, MAX_WIDTH));
      }

      // Migration: previous version stored `sidebarHidden=true`.
      if (savedCollapsedRaw === "true" || savedHiddenRaw === "true") {
        setCollapsed(true);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", `${effectiveWidth}px`);

    try {
      window.localStorage.setItem(STORAGE_WIDTH_KEY, String(width));
      window.localStorage.setItem(STORAGE_COLLAPSED_KEY, collapsed ? "true" : "false");
      // Clean up legacy key (best-effort).
      window.localStorage.setItem(STORAGE_HIDDEN_KEY, "false");
    } catch {
      // ignore
    }
  }, [effectiveWidth, collapsed, width]);

  function beginResize(startClientX: number) {
    dragStartXRef.current = startClientX;
    dragStartWidthRef.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function endResize() {
    dragStartXRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  function onResizeMove(clientX: number) {
    if (dragStartXRef.current == null) return;
    const dx = clientX - dragStartXRef.current;
    const next = clamp(dragStartWidthRef.current + dx, MIN_WIDTH, MAX_WIDTH);
    setWidth(next);
  }

  return (
    <>
      {collapsed && (
        <button
          type="button"
          className="sidebar-mobile-open"
          onClick={() => setCollapsed(false)}
          aria-label="Open sidebar"
        >
          Menu
        </button>
      )}

      <aside
        className={collapsed ? "sidebar sidebar-collapsed" : "sidebar"}
        aria-label="Dashboard sidebar"
      >
        <div className="sidebar-inner">
          <div className="sidebar-top">
            <button
              type="button"
              className="sidebar-icon-button"
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? ">" : "×"}
            </button>

            {!collapsed && (
              <div>
                <div className="sidebar-brand">BudgetExpense</div>
                <div className="sidebar-subtitle">Personal finance</div>
              </div>
            )}
          </div>

          {!collapsed && (
            <>
              <nav className="sidebar-links" aria-label="Dashboard navigation">
                {navItems.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={isActive ? "sidebar-link sidebar-link-active" : "sidebar-link"}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>

              <div className="sidebar-spacer" />

              <div className="sidebar-footer">
                {user?.name && (
                  <div className="sidebar-user">
                    <img
                      className="sidebar-avatar"
                      src={user.picture || ""}
                      alt={user.name}
                      referrerPolicy="no-referrer"
                    />
                    <div className="sidebar-user-meta">
                      <div className="sidebar-user-name">{user.name}</div>
                      <div className="sidebar-user-email">{user.email}</div>
                    </div>
                  </div>
                )}

                <ThemeToggle />

                <a className="sidebar-logout" href="/auth/logout">
                  Log out
                </a>
              </div>
            </>
          )}
        </div>

        {!collapsed && (
          <div
            className="sidebar-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onMouseDown={(e) => {
              e.preventDefault();
              beginResize(e.clientX);

              const onMove = (ev: MouseEvent) => onResizeMove(ev.clientX);
              const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
                endResize();
              };

              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}
            onTouchStart={(e) => {
              const touch = e.touches[0];
              if (!touch) return;
              beginResize(touch.clientX);

              const onMove = (ev: TouchEvent) => {
                const t = ev.touches[0];
                if (t) onResizeMove(t.clientX);
              };
              const onUp = () => {
                window.removeEventListener("touchmove", onMove);
                window.removeEventListener("touchend", onUp);
                endResize();
              };

              window.addEventListener("touchmove", onMove, { passive: true });
              window.addEventListener("touchend", onUp);
            }}
          />
        )}
      </aside>
    </>
  );
}
