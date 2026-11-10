import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { auth } from "../api";

const AuthContext = createContext(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
};

export const AuthProvider = ({ children }) => {
  const [staff, setStaff] = useState(null);
  // `loading` gates the whole app on first paint. Without it the router would
  // briefly render the sign-in screen for an already-authenticated user while
  // /auth/me is still in flight.
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setStaff(await auth.me());
    } catch {
      setStaff(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Any 401 anywhere in the app drops the session (see the axios interceptor).
  useEffect(() => {
    const onUnauthorized = () => setStaff(null);
    window.addEventListener("csd:unauthorized", onUnauthorized);
    return () => window.removeEventListener("csd:unauthorized", onUnauthorized);
  }, []);

  const signOut = useCallback(async () => {
    try {
      // This device stops getting customer messages: a shared desk computer must
      // not keep showing them to whoever sits down next. Before the session ends,
      // because telling the server needs it.
      const { disablePush } = await import("../lib/push");
      await disablePush().catch(() => {});
      // Signing out of CSD signs out of KKMDM in this browser too (KKMDM inside CSD).
      const { KKMDM_URL } = await import("../kkmdm/api.js");
      await fetch(`${KKMDM_URL}/api/auth/logout`, { method: "POST", credentials: "include", headers: { "X-KKMDM": "1" } }).catch(() => {});
      await auth.logout();
    } finally {
      setStaff(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      staff,
      loading,
      // Convenience flag for rendering. NOT a security boundary — every
      // admin-only capability is enforced by requireCsdAdmin on the server.
      isAdmin: staff?.role === "admin",
      // Display only, like isAdmin; the server's section guard is the real check.
      // Admins have everything; no sections set means every staff section.
      can: (section) => staff?.role === "admin" || !staff?.permissions?.length || staff.permissions.includes(section),
      setStaff,
      refresh,
      signOut,
    }),
    [staff, loading, refresh, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
