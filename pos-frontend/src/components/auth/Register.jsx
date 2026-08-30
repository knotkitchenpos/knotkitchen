import { useState } from "react";
import { motion } from "framer-motion";
import { FiHash, FiPhone, FiLock, FiKey, FiCheckCircle } from "react-icons/fi";
import {
  validateStoreId,
  validateStoreOwner,
  sendStoreOtp,
  verifyStoreOtp,
  completeStoreSignup,
} from "../../https";
import { enqueueSnackbar } from "notistack";
import { useDispatch } from "react-redux";
import { setUser } from "../../redux/slices/userSlice";
import { useNavigate } from "react-router-dom";

const Register = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const [step, setStep] = useState(1); // 1: Store ID, 2: Phone Number, 3: OTP & Password
  const [storeId, setStoreId] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [storeData, setStoreData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  // The API returns only a masked phone — the OTP itself is never sent to the
  // client (see userController.sendStoreOtp). In non-production it is printed
  // to the server console, gated on ALLOW_DEV_OTP.
  const [maskedPhone, setMaskedPhone] = useState("");

  // Step 1: Validate Store ID
  const handleStep1 = async (e) => {
    e.preventDefault();
    if (!storeId || !/^\d{6}$/.test(storeId.trim())) {
      enqueueSnackbar("Store ID must be a 6-digit number.", { variant: "error" });
      return;
    }
    setLoading(true);
    try {
      const res = await validateStoreId({ storeId: storeId.trim() });
      if (res.data.success) {
        setStoreData(res.data.data);
        enqueueSnackbar(`Store found: ${res.data.data.storeName}`, { variant: "success" });
        setStep(2);
      }
    } catch (error) {
      const message = error.response?.data?.message || "Invalid Store ID";
      enqueueSnackbar(message, { variant: "error" });
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Validate Owner Phone & Send OTP
  const handleStep2 = async (e) => {
    e.preventDefault();
    if (!phone) {
      enqueueSnackbar("Please enter owner phone number.", { variant: "error" });
      return;
    }
    setLoading(true);
    try {
      // Validate owner phone matches store ID
      await validateStoreOwner({ storeId: storeId.trim(), phone: phone.trim() });

      // Send OTP
      const otpRes = await sendStoreOtp({ storeId: storeId.trim(), phone: phone.trim() });
      if (otpRes.data.success) {
        setOtpSent(true);
        setMaskedPhone(otpRes.data.data?.maskedPhone || "");
        enqueueSnackbar("OTP sent to owner phone number!", { variant: "success" });
        setStep(3);
      }
    } catch (error) {
      const message =
        error.response?.data?.message || "Store ID and Phone Number do not match.";
      enqueueSnackbar(message, { variant: "error" });
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Complete Signup with OTP & Password
  const handleStep3 = async (e) => {
    e.preventDefault();
    if (!otp || otp.trim().length !== 6) {
      enqueueSnackbar("Please enter 6-digit OTP.", { variant: "error" });
      return;
    }
    if (!password || password.length < 6) {
      enqueueSnackbar("Password must be at least 6 characters.", { variant: "error" });
      return;
    }

    setLoading(true);
    try {
      // Complete backend verification and signup
      const res = await completeStoreSignup({
        storeId: storeId.trim(),
        phone: phone.trim(),
        otp: otp.trim(),
        password,
      });

      if (res.data.success) {
        const { _id, name, address, email, phone: userPhone, role } = res.data.data;
        dispatch(setUser({ _id, name, address, email, phone: userPhone, role }));
        enqueueSnackbar("Store signup & verification successful!", { variant: "success" });
        setTimeout(() => {
          navigate("/");
        }, 1000);
      }
    } catch (error) {
      const message = error.response?.data?.message || "OTP verification failed.";
      enqueueSnackbar(message, { variant: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Progress Indicator */}
      <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
        <div className={`flex items-center gap-2 ${step >= 1 ? "text-accent font-semibold" : "text-content-muted"}`}>
          <span className="w-6 h-6 rounded-full border flex items-center justify-center text-xs">1</span>
          <span>Store ID</span>
        </div>
        <div className={`flex items-center gap-2 ${step >= 2 ? "text-accent font-semibold" : "text-content-muted"}`}>
          <span className="w-6 h-6 rounded-full border flex items-center justify-center text-xs">2</span>
          <span>Owner Phone</span>
        </div>
        <div className={`flex items-center gap-2 ${step >= 3 ? "text-accent font-semibold" : "text-content-muted"}`}>
          <span className="w-6 h-6 rounded-full border flex items-center justify-center text-xs">3</span>
          <span>OTP Verify</span>
        </div>
      </div>

      {/* STEP 1 — Enter 6-digit Store ID */}
      {step === 1 && (
        <form onSubmit={handleStep1} className="space-y-4">
          <div className="rounded-lg border border-accent/20 bg-accent/5 p-3">
            <label className="block text-sm font-medium mb-2 text-content-muted">
              Enter 6-Digit Store ID
            </label>
            <div className="input-container flex items-center gap-3">
              <FiHash className="text-content-muted" />
              <input
                type="text"
                name="storeId"
                maxLength={6}
                value={storeId}
                onChange={(e) => setStoreId(e.target.value.replace(/\D/g, ""))}
                placeholder="e.g. 483921"
                className="input-field tracking-widest text-lg font-mono"
                required
              />
            </div>
            <p className="text-xs text-content-muted mt-2">
              Enter the unique 6-digit Store ID issued by the Knot Kitchen Admin Panel.
            </p>
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={loading || storeId.length !== 6}
            className="btn-primary w-full !py-3.5 text-base disabled:opacity-50"
          >
            {loading ? "Verifying Store ID..." : "Verify Store ID"}
          </motion.button>
        </form>
      )}

      {/* STEP 2 — Enter Owner Phone Number */}
      {step === 2 && (
        <form onSubmit={handleStep2} className="space-y-4">
          {storeData && (
            <div className="bg-surface-tertiary p-3 rounded-lg flex items-center gap-2 text-sm text-content mb-2">
              <FiCheckCircle className="text-accent-green text-lg flex-shrink-0" />
              <div>
                <p className="font-semibold">{storeData.storeName}</p>
                <p className="text-xs text-content-muted">Store ID: {storeData.storeId}</p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2 text-content-muted">
              Owner Phone Number
            </label>
            <div className="input-container flex items-center gap-3">
              <FiPhone className="text-content-muted" />
              <input
                type="text"
                name="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Enter owner phone number"
                className="input-field"
                required
              />
            </div>
            <p className="text-xs text-content-muted mt-2">
              Must match the owner phone number registered with this Store ID.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="btn-secondary flex-1 !py-3"
            >
              Back
            </button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={loading || !phone}
              className="btn-primary flex-1 !py-3 text-base disabled:opacity-50"
            >
              {loading ? "Sending OTP..." : "Send OTP"}
            </motion.button>
          </div>
        </form>
      )}

      {/* STEP 3 — OTP Verification & Password */}
      {step === 3 && (
        <form onSubmit={handleStep3} className="space-y-4">
          <div className="bg-surface-tertiary p-3 rounded-lg text-sm mb-2">
            <p className="font-medium text-content">Verification Sent</p>
            <p className="text-xs text-content-muted">
              OTP sent to owner phone number{" "}
              <span className="font-semibold text-content">{maskedPhone || phone}</span>
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-content-muted">
              Enter 6-Digit OTP
            </label>
            <div className="input-container flex items-center gap-3">
              <FiKey className="text-content-muted" />
              <input
                type="text"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="6-digit OTP"
                className="input-field tracking-widest text-center font-mono text-lg"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-content-muted">
              Set Account Password
            </label>
            <div className="input-container flex items-center gap-3">
              <FiLock className="text-content-muted" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Choose account password"
                className="input-field"
                required
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="btn-secondary flex-1 !py-3"
            >
              Back
            </button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={loading || otp.trim().length !== 6}
              className="btn-primary flex-1 !py-3 text-base disabled:opacity-50"
            >
              {loading ? "Verifying..." : "Complete Signup"}
            </motion.button>
          </div>
        </form>
      )}
    </div>
  );
};

export default Register;
