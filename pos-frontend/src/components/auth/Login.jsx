import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiKey, FiPhone, FiLock, FiArrowRight, FiArrowLeft, FiAlertCircle, FiCheckCircle } from "react-icons/fi";
import { useMutation } from "@tanstack/react-query";
import { validateStoreId, sendStoreOtp, verifyStoreOtp } from "../../https/index";
import { enqueueSnackbar } from "notistack";
import { useDispatch } from "react-redux";
import { setUser } from "../../redux/slices/userSlice";
import { useNavigate } from "react-router-dom";

const Login = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  // Multi-step form state: 1 = Store ID, 2 = Phone Number, 3 = OTP Verification
  const [step, setStep] = useState(1);

  const [storeId, setStoreId] = useState("");
  const [storeInfo, setStoreInfo] = useState(null);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // Step 1: Store ID Validation Mutation
  const validateStoreMutation = useMutation({
    mutationFn: (reqData) => validateStoreId(reqData),
    onSuccess: (res) => {
      const data = res.data;
      if (data && data.success) {
        setStoreInfo(data.store);
        setErrorMessage("");
        setStep(2);
      }
    },
    onError: (error) => {
      const msg = error.response?.data?.message || "Invalid Store ID. Please check and try again.";
      setErrorMessage(msg);
      enqueueSnackbar(msg, { variant: "error" });
    },
  });

  // Step 2: Request OTP Mutation
  const requestOtpMutation = useMutation({
    mutationFn: (reqData) => sendStoreOtp(reqData),
    onSuccess: (res) => {
      const data = res.data;
      if (data && data.success) {
        setErrorMessage("");
        enqueueSnackbar("OTP sent to the registered owner phone number.", { variant: "info" });
        setStep(3);
      }
    },
    onError: (error) => {
      const msg = error.response?.data?.message || "Phone number validation failed.";
      setErrorMessage(msg);
      enqueueSnackbar(msg, { variant: "error" });
    },
  });

  // Step 3: OTP Verification Mutation
  const verifyOtpMutation = useMutation({
    mutationFn: (reqData) => verifyStoreOtp(reqData),
    onSuccess: (res) => {
      const { data } = res;
      if (data && data.data) {
        const { _id, name, address, email, phone, role, restaurantId } = data.data;
        dispatch(setUser({ _id, name, address, email, phone, role, restaurantId }));
        enqueueSnackbar(`Welcome back to ${storeInfo?.name || "KnotKitchen POS"}!`, { variant: "success" });
        navigate("/");
      }
    },
    onError: (error) => {
      const msg = error.response?.data?.message || "Invalid OTP. Please check and try again.";
      setErrorMessage(msg);
      enqueueSnackbar(msg, { variant: "error" });
    },
  });

  // Handlers
  const handleStoreIdSubmit = (e) => {
    e.preventDefault();
    setErrorMessage("");
    const cleanId = storeId.trim();
    if (!cleanId || !/^\d{6}$/.test(cleanId)) {
      setErrorMessage("Please enter a valid 6-digit Store ID.");
      return;
    }
    validateStoreMutation.mutate({ storeId: cleanId });
  };

  const handlePhoneSubmit = (e) => {
    e.preventDefault();
    setErrorMessage("");
    const cleanPhone = phone.trim();
    if (!cleanPhone || cleanPhone.length < 7) {
      setErrorMessage("Please enter a valid registered phone number.");
      return;
    }
    requestOtpMutation.mutate({ storeId: storeId.trim(), phone: cleanPhone });
  };

  const handleOtpSubmit = (e) => {
    e.preventDefault();
    setErrorMessage("");
    const cleanOtp = otp.trim();
    if (!cleanOtp || cleanOtp.length !== 6) {
      setErrorMessage("Please enter the 6-digit OTP.");
      return;
    }
    verifyOtpMutation.mutate({ storeId: storeId.trim(), phone: phone.trim(), otp: cleanOtp });
  };

  return (
    <div className="w-full">
      {/* Error Alert */}
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

      {/* Step Indicators */}
      <div className="flex items-center justify-between mb-6 px-2">
        <div className={`flex items-center gap-2 text-xs font-semibold ${step >= 1 ? "text-[#FF5A00]" : "text-[#77839A]"}`}>
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step >= 1 ? "bg-[#FF5A00] text-white" : "bg-[#1E293B] text-[#77839A]"}`}>1</span>
          <span>Store ID</span>
        </div>
        <div className={`h-[1px] flex-1 mx-2 ${step >= 2 ? "bg-[#FF5A00]" : "bg-[#26344B]"}`} />
        <div className={`flex items-center gap-2 text-xs font-semibold ${step >= 2 ? "text-[#FF5A00]" : "text-[#77839A]"}`}>
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step >= 2 ? "bg-[#FF5A00] text-white" : "bg-[#1E293B] text-[#77839A]"}`}>2</span>
          <span>Phone</span>
        </div>
        <div className={`h-[1px] flex-1 mx-2 ${step >= 3 ? "bg-[#FF5A00]" : "bg-[#26344B]"}`} />
        <div className={`flex items-center gap-2 text-xs font-semibold ${step >= 3 ? "text-[#FF5A00]" : "text-[#77839A]"}`}>
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step >= 3 ? "bg-[#FF5A00] text-white" : "bg-[#1E293B] text-[#77839A]"}`}>3</span>
          <span>OTP</span>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* SCREEN 1: STORE ID */}
        {step === 1 && (
          <motion.form
            key="step1"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            onSubmit={handleStoreIdSubmit}
            className="space-y-6"
          >
            <div>
              <div className="input-container flex items-center gap-3 bg-[#0D1526] border-[#26344B] focus-within:border-[#FF5A00] group rounded-xl px-4 py-3.5 border transition-all duration-200 shadow-sm focus-within:shadow-[0_0_0_3px_rgba(255,90,0,0.15)]">
                <FiKey size={18} className="text-[#77839A] group-focus-within:text-[#FF5A00] transition-colors shrink-0" />
                <input
                  type="text"
                  name="storeId"
                  value={storeId}
                  maxLength={6}
                  onChange={(e) => {
                    setErrorMessage("");
                    setStoreId(e.target.value.replace(/\D/g, "").slice(0, 6));
                  }}
                  placeholder="Enter 6-digit Store ID"
                  className="w-full bg-transparent text-[#F5F7FA] text-sm sm:text-base font-mono tracking-wider placeholder:text-[#77839A] placeholder:font-sans placeholder:tracking-normal outline-none"
                  autoFocus
                  required
                  disabled={validateStoreMutation.isPending}
                />
              </div>
              <p className="mt-2.5 text-xs text-[#77839A]">
                Enter the unique 6-digit Store ID provided by KnotKitchen.
              </p>
            </div>

            <div className="pt-2">
              <motion.button
                whileHover={{ y: -1, boxShadow: "0 8px 25px rgba(255, 90, 0, 0.35)" }}
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={validateStoreMutation.isPending || storeId.length !== 6}
                className="w-full py-4 text-base font-semibold rounded-xl bg-gradient-to-r from-[#FF6A00] to-[#FF4D00] text-white shadow-lg flex items-center justify-center gap-3 disabled:opacity-50 transition-all duration-200 cursor-pointer"
              >
                <span>{validateStoreMutation.isPending ? "Validating Store..." : "Continue"}</span>
                {!validateStoreMutation.isPending && <FiArrowRight size={20} />}
              </motion.button>
            </div>
          </motion.form>
        )}

        {/* SCREEN 2: PHONE NUMBER */}
        {step === 2 && (
          <motion.form
            key="step2"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            onSubmit={handlePhoneSubmit}
            className="space-y-6"
          >
            {/* Validated Store Info Banner */}
            <div className="p-3 bg-[#1E293B]/60 border border-[#26344B] rounded-xl flex items-center gap-3">
              <FiCheckCircle className="text-emerald-400 shrink-0" size={18} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[#77839A]">Store Validated</div>
                <div className="text-sm font-semibold text-white truncate">{storeInfo?.storeName || storeInfo?.name || `Store #${storeId}`}</div>
              </div>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-xs text-[#FF5A00] hover:underline shrink-0"
              >
                Change
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#AEB8CA] uppercase tracking-wider mb-2.5">
                Registered Phone Number
              </label>
              <div className="input-container flex items-center gap-3 bg-[#0D1526] border-[#26344B] focus-within:border-[#FF5A00] group rounded-xl px-4 py-3.5 border transition-all duration-200 shadow-sm focus-within:shadow-[0_0_0_3px_rgba(255,90,0,0.15)]">
                <FiPhone size={18} className="text-[#77839A] group-focus-within:text-[#FF5A00] transition-colors shrink-0" />
                <input
                  type="tel"
                  name="phone"
                  value={phone}
                  onChange={(e) => {
                    setErrorMessage("");
                    setPhone(e.target.value);
                  }}
                  placeholder="Enter registered phone number"
                  className="w-full bg-transparent text-[#F5F7FA] text-sm sm:text-base tracking-wider placeholder:text-[#77839A] outline-none"
                  autoFocus
                  required
                  disabled={requestOtpMutation.isPending}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="py-4 px-4 rounded-xl border border-[#26344B] hover:bg-[#1E293B] text-[#AEB8CA] hover:text-white transition-colors flex items-center justify-center gap-2 text-sm font-medium"
              >
                <FiArrowLeft size={16} />
                Back
              </button>
              <motion.button
                whileHover={{ y: -1, boxShadow: "0 8px 25px rgba(255, 90, 0, 0.35)" }}
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={requestOtpMutation.isPending || !phone.trim()}
                className="flex-1 py-4 text-base font-semibold rounded-xl bg-gradient-to-r from-[#FF6A00] to-[#FF4D00] text-white shadow-lg flex items-center justify-center gap-3 disabled:opacity-50 transition-all duration-200 cursor-pointer"
              >
                <span>{requestOtpMutation.isPending ? "Sending OTP..." : "Get OTP"}</span>
                {!requestOtpMutation.isPending && <FiArrowRight size={20} />}
              </motion.button>
            </div>
          </motion.form>
        )}

        {/* SCREEN 3: OTP VERIFICATION */}
        {step === 3 && (
          <motion.form
            key="step3"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            onSubmit={handleOtpSubmit}
            className="space-y-6"
          >
            <div className="p-3 bg-[#1E293B]/60 border border-[#26344B] rounded-xl flex items-center justify-between">
              <div>
                <div className="text-xs text-[#77839A]">OTP sent to {phone}</div>
              </div>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="text-xs text-[#FF5A00] hover:underline shrink-0"
              >
                Change Phone
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#AEB8CA] uppercase tracking-wider mb-2.5">
                6-Digit Verification Code (OTP)
              </label>
              <div className="input-container flex items-center gap-3 bg-[#0D1526] border-[#26344B] focus-within:border-[#FF5A00] group rounded-xl px-4 py-3.5 border transition-all duration-200 shadow-sm focus-within:shadow-[0_0_0_3px_rgba(255,90,0,0.15)]">
                <FiLock size={18} className="text-[#77839A] group-focus-within:text-[#FF5A00] transition-colors shrink-0" />
                <input
                  type="text"
                  name="otp"
                  value={otp}
                  maxLength={6}
                  onChange={(e) => {
                    setErrorMessage("");
                    setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));
                  }}
                  placeholder="Enter 6-digit OTP"
                  className="w-full bg-transparent text-[#F5F7FA] text-lg sm:text-xl font-mono tracking-widest text-center placeholder:text-[#77839A] placeholder:text-sm placeholder:tracking-normal outline-none"
                  autoFocus
                  required
                  disabled={verifyOtpMutation.isPending}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="py-4 px-4 rounded-xl border border-[#26344B] hover:bg-[#1E293B] text-[#AEB8CA] hover:text-white transition-colors flex items-center justify-center gap-2 text-sm font-medium"
              >
                <FiArrowLeft size={16} />
                Back
              </button>
              <motion.button
                whileHover={{ y: -1, boxShadow: "0 8px 25px rgba(255, 90, 0, 0.35)" }}
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={verifyOtpMutation.isPending || otp.length !== 6}
                className="flex-1 py-4 text-base font-semibold rounded-xl bg-gradient-to-r from-[#FF6A00] to-[#FF4D00] text-white shadow-lg flex items-center justify-center gap-3 disabled:opacity-50 transition-all duration-200 cursor-pointer"
              >
                <span>{verifyOtpMutation.isPending ? "Verifying..." : "Verify & Sign In"}</span>
                {!verifyOtpMutation.isPending && <FiCheckCircle size={20} />}
              </motion.button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Login;
