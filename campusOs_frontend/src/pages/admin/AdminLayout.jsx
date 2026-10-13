import { NavLink } from "react-router-dom";
import { Building2, GraduationCap, Users } from "lucide-react";

/**
 * The administration area.
 *
 * Three resources that are all the same shape — a list you can search, and a
 * form that can create or change one — so they share a tab bar and a page
 * heading rather than being three unrelated screens. Only the super
 * administrator reaches this far, which the server re-checks on every request;
 * the tabs are for the reader's benefit, not a control.
 */

const TABS = [
  { to: "/admin/people", label: "People", icon: Users },
  { to: "/admin/departments", label: "Departments", icon: Building2 },
  { to: "/admin/programmes", label: "Programmes", icon: GraduationCap },
];

export default function AdminLayout({ title, description, actions, children }) {
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            {title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-500">
            {description}
          </p>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>

      <nav aria-label="Administration sections">
        <div className="inline-flex gap-1 rounded-2xl bg-white/70 p-1.5 shadow-card ring-1 ring-ink-200/80 backdrop-blur-xl">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  `inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-150 ${
                    isActive
                      ? "aurora text-white shadow-brand"
                      : "text-ink-600 hover:bg-white hover:text-ink-900"
                  }`
                }
              >
                <Icon className="size-4" aria-hidden="true" />
                {tab.label}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {children}
    </div>
  );
}
