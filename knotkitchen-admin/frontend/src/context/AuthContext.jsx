import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { loginApi, logoutApi, getMeApi } from "../api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // On mount: attempt to restore session via /api/admin/me
  useEffect(() => {
    const init = async () => {
      try {
        const res = await getMeApi();
        setAdmin(res.data || null);
      } catch {
        setAdmin(null);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const login = useCallback(async (email, password) => {
    setError("");
    try {
      const res = await loginApi(email, password);
      setAdmin(res.data || null);
      return { success: true };
    } catch (err) {
      const message = err?.response?.data?.message || "Login failed!";
      setError(message);
      return { success: false, message };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutApi();
    } catch {
      // ignore
    }
    setAdmin(null);
  }, []);

  return (
    <AuthContext.Provider value={{ admin, setAdmin, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};