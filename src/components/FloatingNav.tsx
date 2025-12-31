"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import ThemeToggle from "@/components/ThemeToggle";

const navItems = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/transactions", label: "Transactions" },
];

export default function FloatingNav() {
  const pathname = usePathname();
  const { user } = useUser();

  return (
    <aside className="sidebar" aria-label="Dashboard sidebar">
      <div className="sidebar-inner">
        <div className="sidebar-brand">BudgetExpense</div>
        <div className="sidebar-subtitle">Personal finance</div>

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
      </div>
    </aside>
  );
}
