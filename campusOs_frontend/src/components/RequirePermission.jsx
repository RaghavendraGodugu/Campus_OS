import { useAuth } from "../context/AuthContext";
import { EmptyState } from "./ui/States";
import { ShieldAlert } from "lucide-react";
import {
  SkeletonHeading,
  SkeletonStats,
  SkeletonPanel,
} from "./ui/Skeleton";

/**
 * Gate for a route that needs a permission.
 *
 * ## Any of several permissions is enough
 *
 * `permission` may be one name or several, and the reader qualifies if they
 * hold *any*. That distinction matters more than it looks: an institution-wide
 * reader holds `report:read:institution` and NOT `report:read:department`.
 * Demanding the department variant to render Reports locks the Dean — the role
 * that most needs them — out of the page entirely, while the server answers
 * them perfectly well.
 *
 * This is presentation only. The server re-derives every permission on every
 * request, so reaching these children without the permission grants nothing — it
 * just avoids showing a page that would fail on load.
 *
 * The refusal names the role, because "you do not have permission" on its own
 * is a dead end.
 *
 * ## Loading state
 *
 * After login, permissions may not have propagated yet. We show a skeleton
 * rather than a false denial, because the server re-derives permissions on
 * every request anyway — this is just UI courtesy.
 */
export default function RequirePermission({
  permission,
  permissions,
  children,
}) {
  const { canAny, user, isLoading, isAuthenticated, permissions: userPerms } = useAuth();

  const required =
    permissions ??
    (Array.isArray(permission) ? permission : [permission]).filter(Boolean);

  // While the session is still loading, don't deny — show a skeleton instead.
  // This prevents the "not for this" flash on first load after login.
  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <SkeletonHeading width="30%" />
        <SkeletonStats count={3} />
        <SkeletonPanel lines={4} />
      </div>
    );
  }

  // Authenticated but permissions array is empty → still hydrating after login.
  // Show skeleton instead of false denial.
  if (isAuthenticated && user && required.length > 0 && userPerms.length === 0) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <SkeletonHeading width="30%" />
        <SkeletonStats count={3} />
        <SkeletonPanel lines={4} />
      </div>
    );
  }

  if (canAny(...required)) {
    return children;
  }

  return (
    <div className="mx-auto max-w-xl py-10">
      <EmptyState
        icon={ShieldAlert}
        title="You do not have access to this page"
        description={`Your role (${user?.role?.replace(/_/g, " ").toLowerCase()}) does not include this area. If you believe it should, ask an administrator to review your permissions.`}
        action={
          <a
            href="/"
            className="mt-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Back to dashboard
          </a>
        }
      />
    </div>
  );
}
