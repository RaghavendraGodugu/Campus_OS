import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { Loading, UnconfirmedState } from "./ui/States";

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
 */
export default function RequireAuth({ children }) {
  const { isAuthenticated, isLoading, isUnconfirmed, refresh } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <Loading label="Checking your session" />;
  }

  if (isUnconfirmed) {
    return <UnconfirmedState onRetry={() => refresh()} />;
  }

  if (!isAuthenticated) {
    // `state.from` is what makes a redirect return the user where they meant to
    // go, rather than dumping them on the dashboard.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
