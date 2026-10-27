/**
 * Session state.
 *
 * ## The bootstrap failure that matters
 *
 * On load the app must ask the server who it is. If that request fails, the
 * temptation is to treat it as "signed out". That is wrong in a way that is easy
 * to miss: a network blip would log the user out of a perfectly valid session,
 * and worse, a *tampered or expired* token would look identical to a transient
 * failure.
 *
 * So the three outcomes are kept apart:
 *
 *   - 200            → there is a session
 *   - 401            → there is provably no session; this is the only case that
 *                      signs the user out
 *   - anything else  → unknown; keep the user signed in and say the session
 *                      could not be confirmed
 *
 * Only a definite answer is allowed to destroy a session.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import { apiGet, apiPost } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [student, setStudent] = useState(null);

  /**
   * The permission list the *server* computed for this role.
   *
   * Deliberately not reimplemented here. A client-side copy of the permission
   * map is a second source of truth that drifts the moment a role changes on the
   * server, and it would then be wrong in the most confusing direction
   * possible: showing a button the backend will refuse.
   *
   * These decide what to *show*, never what to allow. The server re-derives every
   * one of them on each request regardless of what this client believes.
   */
  const [permissions, setPermissions] = useState([]);
  const [scopes, setScopes] = useState([]);

  const [status, setStatus] = useState("loading"); // loading | authenticated | anonymous | unconfirmed
  const queryClient = useQueryClient();

  const applySession = useCallback((data) => {
    setUser(data.user);
    setStudent(data.student ?? null);
    setPermissions(data.permissions ?? []);
    setScopes(data.scopes ?? []);
    setStatus("authenticated");
  }, []);

  const clearSession = useCallback(() => {
    setUser(null);
    setStudent(null);
    setPermissions([]);
    setScopes([]);
    setStatus("anonymous");
  }, []);

  /**
   * Ask the server who we are.
   *
   * `signal` lets the caller abandon the request: a response that lands after
   * the provider has gone must not set state, or React reports a leak and a
   * stale session can resurrect over a newer one.
   */
  const refresh = useCallback(
    async ({ signal } = {}) => {
      const abandoned = () => signal?.aborted === true;

      try {
        const response = await apiGet("/auth/me");

        if (abandoned()) return null;

        applySession(response.data);
        return response.data.user;
      } catch (error) {
        if (abandoned()) return null;

        if (error?.status === 401) {
          // The only answer permitted to end a session.
          clearSession();
          return null;
        }

        // Could not tell. Keep whatever we had rather than signing the user out
        // on the strength of a network error.
        setStatus((current) =>
          current === "authenticated" ? "authenticated" : "unconfirmed",
        );
        return null;
      }
    },
    [applySession, clearSession],
  );

  useEffect(() => {
    // Read the session once on mount. The abort guard lives inside `refresh`,
    // which is why this is one call rather than an inline fetch — the same code
    // path also serves the manual retry, and a second copy is a second thing to
    // keep correct.
    const controller = new AbortController();

    // The rule below cannot see through the async boundary: `refresh` awaits
    // `/auth/me` before touching any state, so nothing here renders
    // synchronously and there is no cascade to cause.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh({ signal: controller.signal });

    return () => controller.abort();
  }, [refresh]);

  /**
   * Sign in.
   *
   * Two possible outcomes, and the caller has to be ready for both: a session,
   * or a two-factor challenge. Returning the challenge instead of applying a
   * session keeps the decision in one place, so no screen can accidentally treat
   * "password accepted" as "signed in".
   */
  const login = useCallback(
    async (email, password) => {
      const response = await apiPost("/auth/login", { email, password });

      if (response.data.twoFactorRequired) {
        return response.data;
      }

      applySession(response.data);

      if (
        !response.data.permissions ||
        response.data.permissions.length === 0
      ) {
        await refresh();
      }

      // Cached data belongs to the previous session.
      queryClient.clear();

      return response.data.user;
    },
    [applySession, refresh, queryClient],
  );

  /** The second step of a two-factor sign-in. */
  const completeTwoFactor = useCallback(
    async (challenge, code) => {
      const response = await apiPost("/auth/2fa/complete", { challenge, code });

      applySession(response.data);

      if (
        !response.data.permissions ||
        response.data.permissions.length === 0
      ) {
        await refresh();
      }

      queryClient.clear();

      return response.data.user;
    },
    [applySession, refresh, queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await apiPost("/auth/logout");
    } catch {
      // Signing out locally is right even if the server call failed: the user
      // asked to leave, and leaving the UI populated would be worse.
    } finally {
      clearSession();
      queryClient.clear();
    }
  }, [clearSession, queryClient]);

  /**
   * May this user be *shown* the thing guarded by `permission`?
   *
   * For hiding UI, never for authorising anything.
   */
  const can = useCallback(
    (permission) => {
      if (!permission) return true; // No permission named: not gated.
      return permissions.includes(permission);
    },
    [permissions],
  );

  /** Can this user see anything at all out of these? */
  const canAny = useCallback(
    (...required) =>
      required.some((permission) => permissions.includes(permission)),
    [permissions],
  );

  const value = useMemo(
    () => ({
      user,
      student,
      permissions,
      scopes,
      status,
      isAuthenticated: status === "authenticated" && Boolean(user),
      isLoading: status === "loading",
      /** True when a session exists but could not be confirmed. */
      isUnconfirmed: status === "unconfirmed",
      can,
      canAny,
      login,
      completeTwoFactor,
      logout,
      refresh,
    }),
    [
      user,
      student,
      permissions,
      scopes,
      status,
      can,
      canAny,
      login,
      completeTwoFactor,
      logout,
      refresh,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * The session.
 *
 * Kept beside the provider it reads: a `useAuth` in another file would need its
 * own import, and the pairing here is what makes a missing provider an obvious
 * error rather than a mysterious one.
 */
/* eslint-disable-next-line react-refresh/only-export-components -- provider and its hook belong together */
export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }

  return context;
}
