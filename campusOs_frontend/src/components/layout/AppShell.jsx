import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import {
  BarChart3,
  BadgeCheck,
  FileText,
  Inbox,
  IndianRupee,
  LayoutDashboard,
  LogOut,
  User,
  Megaphone,
  Menu,
  Receipt,
  ScrollText,
  ShieldAlert,
  Undo2,
  X,
} from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import { visibleNavItems } from "../../lib/nav";
import { initials } from "../../lib/format";
import NotificationBell from "./NotificationBell";

const ICONS = {
  LayoutDashboard,
  FileText,
  ShieldAlert,
  BadgeCheck,
  Receipt,
  Undo2,
  Megaphone,
  Inbox,
  IndianRupee,
  BarChart3,
  ScrollText,
  User,
};

/**
 * The signed-in shell: sidebar, top bar, and the page.
 *
 * The skip link is first in the DOM because it is only useful before the tab
 * order reaches the navigation, and it is visible on focus rather than on hover,
 * because a keyboard user is not hovering anything.
 */
export default function AppShell() {
  const { user, canAny, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);

  const items = visibleNavItems(canAny);

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/* ===== Sidebar ===== */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-ink-200 bg-white transition-transform lg:static lg:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center justify-between px-5">
            <span className="text-base font-semibold tracking-tight text-brand-700">
              CampusOS
            </span>
            <button
              type="button"
              className="rounded-md p-1 text-ink-500 hover:bg-ink-100 lg:hidden"
              onClick={() => setNavOpen(false)}
              aria-label="Close navigation"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>

          {/* The label is on the nav, not the aside: an aside is a
              `complementary` landmark, and the navigation landmark is what a
              screen-reader user jumps to. */}
          <nav
            aria-label="Main navigation"
            className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4"
          >
            {items.map((item, index) => {
              if (item.section) {
                return (
                  <p
                    key={`section-${item.section}`}
                    className="px-3 pt-5 pb-1.5 text-[11px] font-semibold tracking-wider text-ink-400 uppercase"
                  >
                    {item.section}
                  </p>
                );
              }

              const Icon = ICONS[item.icon] ?? FileText;

              return (
                <NavLink
                  key={`${item.to}-${index}`}
                  to={item.to}
                  end={item.end}
                  onClick={() => setNavOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-brand-50 text-brand-800"
                        : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
                    }`
                  }
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>

          <div className="border-t border-ink-100 p-3">
            {/* The identity block doubles as the way in to your own profile. */}
            <Link
              to="/profile"
              className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-ink-50"
            >
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800"
              >
                {initials(user?.fullName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-800">
                  {user?.fullName}
                </p>
                <p className="truncate text-xs text-ink-500">View profile</p>
              </div>
            </Link>
            <button
              type="button"
              onClick={logout}
              className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50 hover:text-ink-900"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {navOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-ink-900/20 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-label="Close navigation overlay"
        />
      )}

      {/* ===== Main ===== */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            className="rounded-md p-2 text-ink-600 hover:bg-ink-100 lg:hidden"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>

          <div className="flex-1" />

          <RolePill />

          <NotificationBell />
        </header>

        {import.meta.env.VITE_SHOW_DEMO_BANNER === "true" && <DemoBanner />}

        <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** The signed-in role, stated plainly. It changes what the whole app offers. */
function RolePill() {
  const { user } = useAuth();

  return (
    <span className="hidden items-center rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-600 sm:inline-flex">
      {user?.role?.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

/**
 * The demo banner.
 *
 * Only shown when the build is configured to show it, so it cannot appear in a
 * real deployment by accident.
 */
function DemoBanner() {
  return (
    <div className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-xs font-medium text-amber-900 sm:px-6">
      Demo data — these records are not real. Every account uses the password{" "}
      <code className="rounded bg-amber-200 px-1 py-0.5 font-mono">
        Demo@Campus123
      </code>
    </div>
  );
}
