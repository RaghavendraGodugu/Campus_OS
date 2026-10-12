import { useAuth } from "../context/AuthContext";
import { EmptyState } from "./ui/States";
import { ShieldAlert } from "lucide-react";

/**
 * Gate for a route that needs a permission.
 *
 * This is presentation only. The server re-derives every permission on every
 * request, so reaching this component's children without the permission grants
 * nothing — it just avoids showing a user a page that would fail on load.
 *
 * The refusal says which role is needed, because "you do not have permission"
 * without that is a dead end.
 */
export default function RequirePermission({ permission, children }) {
  const { can, user } = useAuth();

  if (can(permission)) {
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
