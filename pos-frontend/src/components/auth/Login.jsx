import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiKey, FiPhone, FiLock, FiArrowRight, FiArrowLeft, FiAlertCircle } from "react-icons/fi";
import { useMutation } from "@tanstack/react-query";
import { checkStoreStatus, setupStorePassword, storeLogin } from "../../https/index";
import { enqueueSnackbar } from "notistack";
import { useDispatch } from "react-redux";
import { setUser } from "../../redux/slices/userSlice";
import { useNavigate } from "react-router-dom";

/**
 * POS sign-in — email/password migration (2026-08-31, replaces phone + OTP).
 *
 * Two-step UX driven by /api/user/store/status:
 *
 *   Step 1 — always: enter Store ID → server tells us whether this store
 *            already has a password.
 *
 *   Step 2 — one of three modes decided by the server, never the client:
 *
 *     LOGIN     (hasPassword: true)   — password field only
 *     SETUP     (hasPassword: false)  — owner phone + new password + confirm
 *     RESET     (opt-in via "Forgot password?" on the LOGIN form)
 *                                     — owner phone + new password + confirm
 *
 * SETUP and RESET both POST to /store/setup-password with the same fields.
 * The server distinguishes at runtime; the client just knows "the user is
 * setting or resetting the password with the owner phone as the knowledge
 * gate".
 *
 * No SMS. No OTP. If the operator has forgotten the owner phone associated
 * with their store as well, the CSD admin panel can reset it (that surface
 * is a follow-up — for now the message on the SETUP screen tells them to
 * contact KnotKitchen support).
 */
const Login = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  // "storeId" → "login" | "setup" | "reset"
  const [step, setStep] = useState("storeId");

  const [storeId, setStoreId] = useState("");
  const [storeInfo, setStoreInfo] = useState(null); // { storeName, ownerPhoneHint }
  const [password, setPassword] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const goBack = () => {
    setErrorMessage("");
    setPassword("");
    setOwnerPhone("");
    setConfirmPw("");
    setStep("storeId");
  };

  const handleLoggedIn = (data) => {
    if (!data) return;
    const { _id, name, address, email, phone, role, restaurantId, storeId: sid, mustChangePassword } = data;
    dispatch(setUser({ _id, name, address, email, phone, role, restaurantId, storeId: sid }));
    enqueueSnackbar(`Welcome back to ${storeInfo?.storeName || "KnotKitchen POS"}!`, { variant: "success" });
    // mustChangePassword is a follow-up screen; until it ships, land on home
    // and surface an advisory. The server still refuses privileged actions
    // via the same flag if needed later.
    if (mustChangePassword) {
      enqueueSnackbar("Please change your password from Settings.", { variant: "warning" });
    }
    navigate("/");
  };

  // --- Step 1: resolve Store ID → decide login vs setup mode --------------
  const statusMutation = useMutation({
    mutationFn: (reqData) => checkStoreStatus(reqData),
    onSuccess: (res) => {
      const data = res.data?.data;
      if (!data) return;
      setStoreInfo(data);
      setErrorMessage("");
      setStep(data.hasPassword ? "login" : "setup");
    },
    onError: (error) => {
      const msg = error.response?.data?.message || "Invalid Store ID. Please check and try again.";
      setErrorMessage(msg);
    },
  });

  // --- Step 2a: LOGIN with password ----------------------------------------
  // Login errors surface ONLY through the inline banner above the form —
  // the corner snackbar was redundant and, worse, occasionally showed a
  // stale interceptor error ("No refresh token provided!") because axios'
  // 401 → refresh path used to fire even for /store/login.
  const loginMutation = useMutation({
    mutationFn: (reqData) => storeLogin(reqData),
    onSuccess: (res) => {
      const data = res.data?.data;
      if (data) handleLoggedIn(data);
    },
    onError: (error) => {
      const status = error.response?.status;
      // The server returns 409 when the store exists but has no password yet
      // (e.g. race between status check and login). Route the user to setup
      // rather than showing "wrong password" for a store they never set one on.
      if (status === 409) {
        setErrorMessage("This store has no password yet — please set one up.");
        setStep("setup");
        setPassword("");
        return;
      }
      setErrorMessage(error.response?.data?.message || "Invalid credentials.");
    },
  });

  // --- Step 2b: SETUP or RESET (server treats them identically) -----------
  const setupMutation = useMutation({
    mutationFn: (reqData) => setupStorePassword(reqData),
    onSuccess: (res) => {
      const data = res.data?.data;
      if (data) handleLoggedIn(data);
    },
    onError: (error) => {
      setErrorMessage(error.response?.data?.message || "Could not set the password.");
    },
  });

  const handleStoreIdSubmit = (e) => {
    e.preventDefault();
    setErrorMessage("");
    if (!/^\d{6}$/.test(storeId.trim())) {
      setErrorMessage("Please enter a valid 6-digit Store ID.");
      return;
    }
    statusMutation.mutate({ storeId: storeId.trim() });
  };

  const handleLoginSubmit = (e) => {
    e.preventDefault();
    setErrorMessage("");
    const cleanPhone = ownerPhone.replace(/\D/g, "");
    if (cleanPhone.length !== 10) {
      setErrorMessage("Enter your 10-digit phone number.");
      return;
    }
    if (!password) {
      setErrorMessage("Please enter your password.");
      return;
    }
    loginMutation.mutate({ storeId: storeId.trim(), phone: cleanPhone, password });
  };

  const handleSetupSubmit = (e) => {
    e.preventDefault();
    setErrorMessage("");
    const cleanPhone = ownerPhone.replace(/\D/g, "");
    if (cleanPhone.length !== 10) {
      setErrorMessage("Enter the store owner's 10-digit phone number.");
      return;
    }
    if (password.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPw) {
      setErrorMessage("The two passwords do not match.");
      return;
    }
    setupMutation.mutate({ storeId: storeId.trim(), ownerPhone: cleanPhone, password });
  };

  const busy =
    statusMutation.isPending || loginMutation.isPending || setupMutation.isPending;

  return (
    <div className="w-full">
      {errorMessage && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3.5 mb-6 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-3 text-red-400 text-xs sm:text-sm font-medium"
        >
          <FiAlertCircle size={18} className="shrink-0 mt-0.5" />
          <span className="flex-1">{errorMessage}</span>
        </motion.div>
      )}

      <AnimatePresence mode="wait">
        {step === "storeId" && (
          <motion.form
            key="storeId"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            onSubmit={handleStoreIdSubmit}
            className="space-y-6"
          >
            <label className="block">
              <span className="text-xs font-semibold text-[#AEB8CA] uppercase tracking-wider">Store ID</span>
              <div className="mt-2.5 flex items-center gap-3 bg-[#0D1526] border-[#26344B] focus-within:border-[#FF5A00] group rounded-xl px-4 py-3.5 border transition-all duration-200 shadow-sm focus-within:shadow-[0_0_0_3px_rgba(255,90,0,0.15)]">
                <FiKey size={18} className="text-[#77839A] group-focus-within:text-[#FF5A00] transition-colors shrink-0" />
                <input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  required
                  maxLength={6}
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  disabled={busy}
                  placeholder="Enter your 6-digit Store ID"
                  className="w-full bg-transparent text-[#F5F7FA] text-lg font-mono tracking-widest placeholder:text-[#77839A] placeholder:text-sm placeholder:tracking-normal outline-none"
                />
              </div>
            </label>

            <button
              type="submit"
              disabled={busy || !storeId}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#FF5A00] py-3.5 font-semibold text-white disabled:opacity-60 hover:bg-[#FF7A2A] transition"
            >
              {statusMutation.isPending ? "Checking…" : "Continue"}
              {!statusMutation.isPending && <FiArrowRight aria-hidden="true" />}
            </button>
          </motion.form>
        )}

        {step === "login" && (
          <motion.form
            key="login"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            onSubmit={handleLoginSubmit}
            className="space-y-6"
          >
            <div className="p-3 bg-[#1E293B]/60 border border-[#26344B] rounded-xl flex items-center justify-between">
              <div>
                <div className="text-xs text-[#77839A]">
                  Signing in to <span className="font-semibold text-[#F5F7FA]">{storeInfo?.storeName}</span>
                </div>
                <div className="text-xs text-[#77839A] mt-0.5">Store ID {storeId}</div>
              </div>
              <button
                type="button"
                onClick={goBack}
                className="text-xs text-[#FF5A00] hover:underline shrink-0 inline-flex items-center gap-1"
              >
                <FiArrowLeft size={12} aria-hidden="true" /> Change
              </button>
            </div>

            <label className="block">
              <span className="text-xs font-semibold text-[#AEB8CA] uppercase tracking-wider">Your phone</span>
              <div className="mt-2.5 flex items-center gap-3 bg-[#0D1526] border-[#26344B] focus-within:border-[#FF5A00] group rounded-xl px-4 py-3.5 border transition-all duration-200 shadow-sm focus-within:shadow-[0_0_0_3px_rgba(255,90,0,0.15)]">
                <FiPhone size={18} className="text-[#77839A] group-focus-within:text-[#FF5A00] transition-colors shrink-0" />
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  autoFocus
                  required
                  maxLength={10}
                  value={ownerPhone}
                  onChange={(e) => setOwnerPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  disabled={busy}
                  placeholder="10-digit phone"
                  className="w-full bg-transparent text-[#F5F7FA] text-base placeholder:text-[#77839A] outline-none"
                />
              </div>
              <span className="mt-1 block text-[11px] text-[#77839A]">
                The phone tied to your staff account for this store.
              </span>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-[#AEB8CA] uppercase tracking-wider">Password</span>
              <div className="mt-2.5 flex items-center gap-3 bg-[#0D1526] border-[#26344B] focus-within:border-[#FF5A00] group rounded-xl px-4 py-3.5 border transition-all duration-200 shadow-sm focus-within:shadow-[0_0_0_3px_rgba(255,90,0,0.15)]">
                <FiLock size={18} className="text-[#77839A] group-focus-within:text-[#FF5A00] transition-colors shrink-0" />
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  placeholder="Enter your password"
                  className="w-full bg-transparent text-[#F5F7FA] text-base placeholder:text-[#77839A] outline-none"
                />
              </div>
            </label>

            <button
              type="submit"
              disabled={busy || !password || ownerPhone.replace(/\D/g, "").length !== 10}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#FF5A00] py-3.5 font-semibold text-white disabled:opacity-60 hover:bg-[#FF7A2A] transition"
            >
              {loginMutation.isPending ? "Signing in…" : "Sign in"}
              {!loginMutation.isPending && <FiArrowRight aria-hidden="true" />}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep("reset");
                setPassword("");
                setErrorMessage("");
              }}
              className="w-full text-xs text-[#77839A] hover:text-[#FF5A00] transition"
            >
              Forgot password?
            </button>
          </motion.form>
        )}

        {(step === "setup" || step === "reset") && (
          <motion.form
            key={step}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            onSubmit={handleSetupSubmit}
            className="space-y-5"
          >
            <div className="p-3 bg-[#1E293B]/60 border border-[#26344B] rounded-xl">
              <div className="text-xs text-[#F5F7FA] font-semibold">
                {step === "setup" ? "First-time setup" : "Reset password"}
              </div>
              <div className="text-xs text-[#77839A] mt-1">
                {step === "setup"
                  ? `Set the password for ${storeInfo?.storeName || "your store"}. You will use it every day to sign in.`
                  : "Enter the store owner's phone to authorise this password change."}
              </div>
              {storeInfo?.ownerPhoneHint && (
                <div className="text-[11px] text-[#77839A] mt-1.5">
                  Owner phone on record: <span className="font-mono">{storeInfo.ownerPhoneHint}</span>
                </div>
              )}
              <button
                type="button"
                onClick={goBack}
                className="mt-2 text-xs text-[#FF5A00] hover:underline inline-flex items-center gap-1"
              >
                <FiArrowLeft size={12} aria-hidden="true" /> Change Store ID
              </button>
            </div>

            <label className="block">
              <span className="text-xs font-semibold text-[#AEB8CA] uppercase tracking-wider">Owner phone number</span>
              <div className="mt-2.5 flex items-center gap-3 bg-[#0D1526] border-[#26344B] focus-within:border-[#FF5A00] group rounded-xl px-4 py-3.5 border transition-all duration-200 shadow-sm focus-within:shadow-[0_0_0_3px_rgba(255,90,0,0.15)]">
                <FiPhone size={18} className="text-[#77839A] group-focus-within:text-[#FF5A00] transition-colors shrink-0" />
                <input
                  type="tel"
                  autoComplete="tel"
                  inputMode="numeric"
                  autoFocus
                  required
                  maxLength={10}
                  value={ownerPhone}
                  onChange={(e) => setOwnerPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  disabled={busy}
                  placeholder="10-digit registered phone"
                  className="w-full bg-transparent text-[#F5F7FA] text-base font-mono tracking-wider placeholder:text-[#77839A] placeholder:font-sans placeholder:tracking-normal outline-none"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-[#AEB8CA] uppercase tracking-wider">
                {step === "setup" ? "Create password" : "New password"}
              </span>
              <div className="mt-2.5 flex items-center gap-3 bg-[#0D1526] border-[#26344B] focus-within:border-[#FF5A00] group rounded-xl px-4 py-3.5 border transition-all duration-200 shadow-sm focus-within:shadow-[0_0_0_3px_rgba(255,90,0,0.15)]">
                <FiLock size={18} className="text-[#77839A] group-focus-within:text-[#FF5A00] transition-colors shrink-0" />
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  placeholder="At least 8 characters"
                  className="w-full bg-transparent text-[#F5F7FA] text-base placeholder:text-[#77839A] outline-none"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-[#AEB8CA] uppercase tracking-wider">Confirm password</span>
              <div className="mt-2.5 flex items-center gap-3 bg-[#0D1526] border-[#26344B] focus-within:border-[#FF5A00] group rounded-xl px-4 py-3.5 border transition-all duration-200 shadow-sm focus-within:shadow-[0_0_0_3px_rgba(255,90,0,0.15)]">
                <FiLock size={18} className="text-[#77839A] group-focus-within:text-[#FF5A00] transition-colors shrink-0" />
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  disabled={busy}
                  placeholder="Re-enter the password"
                  className="w-full bg-transparent text-[#F5F7FA] text-base placeholder:text-[#77839A] outline-none"
                />
              </div>
            </label>

            <button
              type="submit"
              disabled={busy || !ownerPhone || !password || !confirmPw}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#FF5A00] py-3.5 font-semibold text-white disabled:opacity-60 hover:bg-[#FF7A2A] transition"
            >
              {setupMutation.isPending
                ? "Saving…"
                : step === "setup"
                ? "Create password & sign in"
                : "Reset & sign in"}
              {!setupMutation.isPending && <FiArrowRight aria-hidden="true" />}
            </button>

            <p className="text-[11px] text-[#77839A] text-center">
              Owner phone doesn&apos;t match either? Contact KnotKitchen support.
            </p>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Login;
