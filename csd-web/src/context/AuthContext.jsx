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
      setStaff,
      refresh,
      signOut,
    }),
    [staff, loading, refresh, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
