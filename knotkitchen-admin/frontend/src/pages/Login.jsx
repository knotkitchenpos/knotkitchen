import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { admin, loading, login, error } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (admin) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    setSubmitting(true);
    const res = await login(email, password);
    setSubmitting(false);
    if (res.success) {
      navigate("/");
    } else {
      setFormError(res.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Knot<span className="text-emerald-600">Kitchen</span>
            </h1>
            <p className="text-sm text-slate-500 mt-1">Admin Portal — Secure Access</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {(error || formError) && (
              <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {formError || error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@knotkitchen.io"
                className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-lg bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 transition disabled:opacity-50"
            >
              {submitting ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-slate-500 mt-4">
          KnotKitchen Remote Admin Portal — separate from the restaurant POS
        </p>
      </div>
    </div>
  );
}