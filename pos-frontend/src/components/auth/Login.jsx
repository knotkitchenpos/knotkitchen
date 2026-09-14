import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiKey, FiPhone, FiLock, FiArrowRight, FiArrowLeft, FiAlertCircle } from "react-icons/fi";
import { useMutation } from "@tanstack/react-query";
import {
  checkStoreStatus,
  checkStoreAccountStatus,
  setStoreAccountPassword,
  setupStorePassword,
  storeLogin,
} from "../../https/index";
import { enqueueSnackbar } from "notistack";
import { useDispatch } from "react-redux";
import { setUser } from "../../redux/slices/userSlice";
import { setActiveStoreId } from "../../utils/storeSession";
import { useNavigate } from "react-router-dom";
import { SUPPORT_PHONE, SUPPORT_TEL } from "../../constants/support";

/**
 * POS sign-in — email/password migration (2026-08-31, replaces phone + OTP).
 *
 * Two-step UX driven by /api/user/store/status:
 *
 *   Step 1 — always: enter Store ID → server tells us whether this store
 *            already has a password.
 *
 *   Step 2 — one of two modes decided by the server, never the client:
 *
 *     LOGIN  (hasPassword: true)   — phone + password
 *     SETUP  (hasPassword: false)  — owner phone + new password + confirm
 *
 * "hasPassword" means a person actually chose one. A store that exists only
 * as an admin-created Store ID, or whose sole account was auto-seeded by the
 * CSD "Open POS" handoff, reports false and lands the manager on SETUP —
 * which is the whole point of handing them a bare Store ID.
 *
 * There is deliberately NO self-service reset here. Recovery goes through
 * KnotKitchen support / CSD, so the owner phone is not a standing
 * password-change gate on a public form.
 *
 * No SMS. No OTP.
 */
const Login = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  // storeId -> phone -> ("password" | "createPassword"), or "setup" for a
  // store that has never been claimed at all.
  //
  // The phone step exists because a staff account created by the owner has no
  // password yet: asking for one before we know who is signing in would show
  // a field they cannot fill.
  const [step, setStep] = useState("storeId");
  const [accountName, setAccountName] = useState("");

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
    // Bind THIS TAB to this takeaway before anything else fires, so every
    // request from here reads this store's session cookie and not one
    // belonging to another takeaway signed in from the same browser.
    setActiveStoreId(sid);
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
      setStep(data.hasPassword ? "phone" : "setup");
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
        const code = error.response?.data?.code;
        if (code === "ACCOUNT_NO_PASSWORD") {
          // This person has never set one; send them to Create Password
          // rather than telling them their password is wrong.
          setErrorMessage("");
          setPassword("");
          setStep("createPassword");
          return;
        }
        setErrorMessage("This store has no password yet — please set one up.");
        setStep("setup");
        setPassword("");
        return;
      }
      setErrorMessage(error.response?.data?.message || "Invalid credentials.");
    },
  });

  // --- Step 2: who is signing in? -----------------------------------------
  // Decides between a password field and Create Password, so a staff member
  // on their first shift is never asked for a password that does not exist.
  const accountMutation = useMutation({
    mutationFn: (reqData) => checkStoreAccountStatus(reqData),
    onSuccess: (res) => {
      const data = res.data?.data || {};
      setErrorMessage("");
      setAccountName(data.name || "");
      if (!data.exists) {
        setErrorMessage("No account with that phone number at this store.");
        return;
      }
      setStep(data.needsPasswordSetup ? "createPassword" : "password");
    },
    onError: (error) => {
      setErrorMessage(error.response?.data?.message || "Could not check that number.");
    },
  });

  // --- Step 3b: create the password on a first sign-in --------------------
  const createPasswordMutation = useMutation({
    mutationFn: (reqData) => setStoreAccountPassword(reqData),
    onSuccess: (res) => {
      const data = res.data?.data;
      if (data) handleLoggedIn(data);
    },
    onError: (error) => {
      // The account gained a password between the check and the submit.
      if (error.response?.data?.code === "ACCOUNT_HAS_PASSWORD") {
        setErrorMessage("This account already has a password. Please sign in.");
        setPassword("");
        setConfirmPw("");
        setStep("password");
        return;
      }
      setErrorMessage(error.response?.data?.message || "Could not create the password.");
    },
  });

  // --- Step 2b: first-time SETUP -----------------------------------------
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

  const handlePhoneSubmit = (e) => {
    e.preventDefault();
    setErrorMessage("");
    const cleanPhone = ownerPhone.replace(/\D/g, "");
    if (cleanPhone.length !== 10) {
      setErrorMessage("Enter your 10-digit phone number.");
      return;
    }
    accountMutation.mutate({ storeId: storeId.trim(), phone: cleanPhone });
  };

  const handleCreatePasswordSubmit = (e) => {
    e.preventDefault();
    setErrorMessage("");
    if (password.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPw) {
      setErrorMessage("The two passwords do not match.");
      return;
    }
    createPasswordMutation.mutate({
      storeId: storeId.trim(),
      phone: ownerPhone.replace(/\D/g, ""),
      password,
    });
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
    statusMutation.isPending ||
    loginMutation.isPending ||
    setupMutation.isPending ||
    accountMutation.isPending ||
    createPasswordMutation.isPending;

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

        {step === "phone" && (
          <motion.form
            key="phone"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            onSubmit={handlePhoneSubmit}
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

            <button
              type="submit"
              disabled={busy || ownerPhone.replace(/\D/g, "").length !== 10}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#FF5A00] py-3.5 font-semibold text-white disabled:opacity-60 hover:bg-[#FF7A2A] transition"
            >
              {accountMutation.isPending ? "Checking…" : "Continue"}
              {!accountMutation.isPending && <FiArrowRight aria-hidden="true" />}
            </button>
          </motion.form>
        )}

        {step === "password" && (
          <motion.form
            key="password"
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

            <div className="text-xs text-[#77839A]">
              {accountName ? (
                <>
                  Signing in as <span className="font-semibold text-[#F5F7FA]">{accountName}</span>
                  {" · "}
                </>
              ) : null}
              {ownerPhone}
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setPassword("");
                  setErrorMessage("");
                }}
                className="ml-2 text-[#FF5A00] hover:underline"
              >
                Change
              </button>
            </div>

            <label className="block">
              <span className="text-xs font-semibold text-[#AEB8CA] uppercase tracking-wider">Password</span>
              <div className="mt-2.5 flex items-center gap-3 bg-[#0D1526] border-[#26344B] focus-within:border-[#FF5A00] group rounded-xl px-4 py-3.5 border transition-all duration-200 shadow-sm focus-within:shadow-[0_0_0_3px_rgba(255,90,0,0.15)]">
                <FiLock size={18} className="text-[#77839A] group-focus-within:text-[#FF5A00] transition-colors shrink-0" />
                <input
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  required
                  minLength={8}
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
              disabled={busy || !password}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#FF5A00] py-3.5 font-semibold text-white disabled:opacity-60 hover:bg-[#FF7A2A] transition"
            >
              {loginMutation.isPending ? "Signing in…" : "Sign in"}
              {!loginMutation.isPending && <FiArrowRight aria-hidden="true" />}
            </button>

            <p className="text-[11px] text-[#77839A] text-center">
              Forgot your password? Contact KnotKitchen support on{" "}
              <a href={SUPPORT_TEL} className="font-bold underline">{SUPPORT_PHONE}</a>.
            </p>
          </motion.form>
        )}

        {step === "createPassword" && (
          <motion.form
            key="createPassword"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            onSubmit={handleCreatePasswordSubmit}
            className="space-y-5"
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

            <div className="p-3 bg-[#1E293B]/60 border border-[#26344B] rounded-xl">
              <div className="text-xs text-[#F5F7FA] font-semibold">Create your password</div>
              <div className="text-xs text-[#77839A] mt-1">
                {accountName ? <>Welcome, {accountName}. </> : null}
                This is your first sign-in, so choose a password now. From next
                time you will use the Store ID, your phone and this password.
              </div>
            </div>

            <label className="block">
              <span className="text-xs font-semibold text-[#AEB8CA] uppercase tracking-wider">Create new password</span>
              <div className="mt-2.5 flex items-center gap-3 bg-[#0D1526] border-[#26344B] focus-within:border-[#FF5A00] group rounded-xl px-4 py-3.5 border transition-all duration-200 shadow-sm focus-within:shadow-[0_0_0_3px_rgba(255,90,0,0.15)]">
                <FiLock size={18} className="text-[#77839A] group-focus-within:text-[#FF5A00] transition-colors shrink-0" />
                <input
                  type="password"
                  autoComplete="new-password"
                  autoFocus
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
              disabled={busy || !password || !confirmPw}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#FF5A00] py-3.5 font-semibold text-white disabled:opacity-60 hover:bg-[#FF7A2A] transition"
            >
              {createPasswordMutation.isPending ? "Saving…" : "Create password & sign in"}
              {!createPasswordMutation.isPending && <FiArrowRight aria-hidden="true" />}
            </button>
          </motion.form>
        )}

        {step === "setup" && (
          <motion.form
            key="setup"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            onSubmit={handleSetupSubmit}
            className="space-y-5"
          >
            <div className="p-3 bg-[#1E293B]/60 border border-[#26344B] rounded-xl">
              <div className="text-xs text-[#F5F7FA] font-semibold">First-time setup</div>
              <div className="text-xs text-[#77839A] mt-1">
                {`Set the password for ${storeInfo?.storeName || "your store"}. You will use it every day to sign in.`}
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
                Create password
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
              {setupMutation.isPending ? "Saving…" : "Create password & sign in"}
              {!setupMutation.isPending && <FiArrowRight aria-hidden="true" />}
            </button>

            <p className="text-[11px] text-[#77839A] text-center">
              Owner phone doesn&apos;t match? Contact KnotKitchen support on{" "}
              <a href={SUPPORT_TEL} className="font-bold underline">{SUPPORT_PHONE}</a>.
            </p>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Login;
