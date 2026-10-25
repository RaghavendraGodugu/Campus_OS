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
    to: "/profile",
    label: "Profile",
    icon: "User",
    // Not gated: every role has one, and there is nothing here to gate. The
    // page shows different content per role, and the server decides what is
    // editable regardless of what this nav decides to show.
    permission: null,
  },

  {
    to: "/timetable",
    label: "Timetable",
    icon: "CalendarDays",
    // Any of the three read scopes qualifies: institution readers do not hold
    // the `own` variant, and gating on that alone would hide the page from the
    // people who see the most.
    permissions: [
      "timetable:read:own",
      "timetable:read:department",
      "timetable:read:institution",
    ],
  },

  {
    to: "/attendance",
    label: "Attendance",
    icon: "ClipboardCheck",
    permissions: [
      "attendance:read:own",
      "attendance:read:department",
      "attendance:read:institution",
    ],
  },

  {
    to: "/results",
    label: "Results",
    icon: "GraduationCap",
    permissions: [
      "result:read:own",
      "result:read:department",
      "result:read:institution",
    ],
  },

  {
    to: "/hostel",
    label: "Hostel",
    icon: "BedDouble",
    permissions: ["hostel:read:own", "hostel:read:institution"],
  },
  {
    to: "/library",
    label: "Library",
    icon: "Library",
    permissions: ["library:read:own", "library:read:institution"],
  },
  {
    to: "/events",
    label: "Events",
    icon: "CalendarRange",
    permission: "event:read",
  },
  {
    to: "/directory",
    label: "Directory",
    icon: "Users",
    permission: "staff-directory:read",
  },

  {
    to: "/placements",
    label: "Placements",
    icon: "Briefcase",
    permissions: ["placement:read:own", "placement:read:institution"],
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
  {
    to: "/management/tax",
    label: "Tax registration",
    icon: "Receipt",
    permission: "invoice:manage:institution",
  },
  {
    to: "/management/certificate-templates",
    label: "Certificate templates",
    icon: "FileText",
    permission: "certificate:issue:institution",
  },
  {
    to: "/management/academics",
    label: "Academics",
    icon: "BookOpen",
    permissions: [
      "subject:manage:institution",
      "subject:manage:department",
      "room:manage:institution",
    ],
  },
  {
    to: "/management/terms",
    label: "Academic terms",
    icon: "CalendarRange",
    permission: "academic-term:manage:institution",
  },

  { section: "Oversight" },
  {
    to: "/admin/people",
    label: "People",
    icon: "Settings",
    section: "Administration",
    permission: "user:read:institution",
  },
  {
    to: "/admin/services",
    label: "Services",
    icon: "ListChecks",
    section: "Administration",
    permission: "request-type:manage:institution",
  },
  {
    to: "/admin/students",
    label: "Import",
    icon: "Upload",
    section: "Administration",
    permission: "user:manage:institution",
  },
  {
    to: "/admin/departments",
    label: "Departments",
    icon: "Building2",
    section: "Administration",
    permission: "department:manage:institution",
  },
  {
    to: "/admin/programmes",
    label: "Programmes",
    icon: "GraduationCap",
    section: "Administration",
    permission: "program:manage:institution",
  },

  {
    to: "/analytics",
    label: "Campus overview",
    icon: "BarChart3",
    permissions: [
      "hostel:read:institution",
      "library:read:institution",
      "placement:read:institution",
      "attendance:read:institution",
      "result:read:institution",
    ],
  },
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
  {
    /*
     * Seeded only into demo data. In a real deployment the first super
     * administrator comes from `npm run create-admin` on the server, because an
     * endpoint anyone could reach would let whoever found it first claim the
     * institution.
     */
    email: "demo.admin@campusos.local",
    label: "Administrator",
    name: "Accounts and structure",
  },
];
