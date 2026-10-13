/**
 * Navigation, and which permission each item needs.
 *
 * The permission strings are the *server's* names. This file decides what to
 * show; it never decides what is allowed. Hiding a link a user could have used
 * is a small inconvenience, and far better than showing a link that fails with
 * a 403 when clicked.
 */
export const NAV_ITEMS = [
  {
    to: "/",
    label: "Dashboard",
    icon: "LayoutDashboard",
    permission: null,
    end: true,
  },

  {
    to: "/requests",
    label: "Requests",
    icon: "FileText",
    permission: "request:read:own",
  },
  {
    to: "/complaints",
    label: "Complaints",
    icon: "ShieldAlert",
    permission: "complaint:create:own",
  },
  {
    to: "/certificates",
    label: "Certificates",
    icon: "BadgeCheck",
    permission: "certificate:apply:own",
  },

  {
    to: "/finance/invoices",
    label: "Invoices",
    icon: "Receipt",
    permission: "invoice:read:own",
  },
  {
    to: "/finance/refunds",
    label: "Refunds",
    icon: "Undo2",
    permission: "refund:request:own",
  },

  {
    to: "/announcements",
    label: "Announcements",
    icon: "Megaphone",
    permission: "announcement:read:institution",
  },

  { section: "Management" },
  {
    to: "/management/requests",
    label: "Requests",
    icon: "Inbox",
    permission: "request:read:assigned",
  },
  {
    to: "/management/complaints",
    label: "Complaints",
    icon: "ShieldAlert",
    permission: "complaint:read:assigned",
  },
  {
    to: "/management/certificates",
    label: "Certificates",
    icon: "BadgeCheck",
    permissions: [
      "certificate:read:assigned",
      "certificate:read:department",
      "certificate:read:institution",
    ],
  },
  {
    to: "/management/finance",
    label: "Finance",
    icon: "IndianRupee",
    permission: "payment:read:institution",
  },
  {
    to: "/management/announcements",
    label: "Post notice",
    icon: "Megaphone",
    permission: "announcement:manage:institution",
  },

  { section: "Oversight" },
  {
    to: "/reports",
    label: "Reports",
    icon: "BarChart3",
    permission: "report:read:department",
  },
  {
    to: "/audit",
    label: "Audit trail",
    icon: "ScrollText",
    permission: "audit:read:department",
  },
];

/**
 * Items this user may see, with empty sections removed.
 *
 * Takes `canAny`, because an item may be gated on any one of several
 * permissions — an institution-wide reader does not hold the department-scoped
 * variant of anything.
 */
export function visibleNavItems(canAny) {
  return NAV_ITEMS.filter((item) => {
    if (item.section) return true;
    if (item.permissions) return canAny(...item.permissions);
    return item.permission === null || canAny(item.permission);
  }).filter((item, index, list) => {
    // Drop a section heading that no longer introduces anything.
    if (!item.section) return true;
    const next = list[index + 1];
    return !next || next.section === undefined;
  });
}

/** Roles shown on the sign-in page, so the demo accounts are discoverable. */
export const DEMO_ACCOUNTS = [
  {
    email: "demo.student.democs001@campusos.local",
    label: "Student",
    name: "A student view",
  },
  {
    email: "demo.faculty@campusos.local",
    label: "Faculty",
    name: "Faculty view",
  },
  {
    email: "demo.hod@campusos.local",
    label: "HOD",
    name: "Head of department",
  },
  {
    email: "demo.exam@campusos.local",
    label: "Exam admin",
    name: "Examinations",
  },
  { email: "demo.accounts@campusos.local", label: "Accounts", name: "Finance" },
  {
    email: "demo.support@campusos.local",
    label: "Support",
    name: "Service desk",
  },
  {
    email: "demo.dean@campusos.local",
    label: "Dean",
    name: "Institution-wide",
  },
  {
    email: "demo.principal@campusos.local",
    label: "Principal",
    name: "Institution-wide",
  },
];
