import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { UnconfirmedState } from "./ui/States";
import {
  SkeletonHeading,
  SkeletonPanel,
  SkeletonRegion,
  SkeletonStats,
} from "./ui/Skeleton";

/**
 * Gate for signed-in routes.
 *
 * Three states, kept apart on purpose:
 *
 *  - still loading     → a spinner. Saying "signed out" now would flash the
 *                        login page at a signed-in user on every reload.
 *  - unconfirmed       → the server did not answer. The user keeps their session
 *                        and is offered a retry; only a definite 401 signs out.
 *  - anonymous         → redirect, remembering where they were headed.
 *  - owing a password  → the set-password screen, and nothing else.
 *
 * That last one exists because an administrator-provisioned account still works
 * on a password the institute knows. The gate is a courtesy — the server
 * enforces every permission regardless — but it means the person is not shown a
 * dashboard full of other people's business before replacing it.
 */
/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {boolean} [props.allowUnchangedPassword]
 *   Set on the set-password route itself. Without it that route redirects to
 *   itself, because the guard sees a flag it is meant to send elsewhere — a
 *   loop that renders nothing at all, which is a very confusing way for a page
 *   to fail.
 */
export default function RequireAuth({
  children,
  allowUnchangedPassword = false,
}) {
  const { isAuthenticated, isLoading, isUnconfirmed, user, refresh } =
    useAuth();
  const location = useLocation();

  /**
   * A page-shaped shell rather than a spinner in a blank void.
   *
   * This renders on every single navigation, so it is the most-seen loading
   * state in the app. A spinner here means the entire page collapses to one
   * line of text and then expands back out, several times per session.
   */
  if (isLoading) {
    return (
      <SkeletonRegion
        label="Checking your session"
        className="mx-auto max-w-4xl space-y-6"
      >
        <SkeletonHeading width="30%" />
        <SkeletonStats count={3} />
        <SkeletonPanel lines={4} />
      </SkeletonRegion>
    );
  }

  if (isUnconfirmed) {
    return <UnconfirmedState onRetry={() => refresh()} />;
  }

  if (!isAuthenticated) {
    // `state.from` is what makes a redirect return the user where they meant to
    // go, rather than dumping them on the dashboard.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Checked after authentication, or it would loop: the set-password screen
  // needs a session to exist at all.
  if (user?.mustChangePassword && !allowUnchangedPassword) {
    return <Navigate to="/set-password" replace />;
  }

  return children;
}
