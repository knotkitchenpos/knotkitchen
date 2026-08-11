import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiMail, FiPhone, FiLock, FiX, FiSend, FiKey } from "react-icons/fi";
import { useMutation } from "@tanstack/react-query";
import { login } from "../../https/index";
import { enqueueSnackbar } from "notistack";
import { useDispatch } from "react-redux";
import { setUser } from "../../redux/slices/userSlice";
import { useNavigate } from "react-router-dom";

const Login = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [formData, setFormData] = useState({ email: "", phone: "", password: "", productId: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetSent, setResetSent] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      ...(formData.email ? { email: formData.email } : { phone: formData.phone }),
      password: formData.password,
      productId: formData.productId,
    };
    loginMutation.mutate(payload);
  };

  const loginMutation = useMutation({
    mutationFn: (reqData) => login(reqData),
    onSuccess: (res) => {
      const { data } = res;
      const { _id, name, address, email, phone, role } = data.data;
      dispatch(setUser({ _id, name, address, email, phone, role }));
      enqueueSnackbar(`Welcome back, ${name}!`, { variant: "success" });
      navigate("/");
    },
    onError: (error) => {
      const message =
        error.response?.data?.message ||
        "Unable to connect to the server. Please make sure the backend is running.";
      enqueueSnackbar(message, { variant: "error" });
    },
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-2 text-content-muted">Email or Phone</label>
        <div className="grid grid-cols-2 gap-2">
          <div className="input-container flex items-center gap-3">
            <FiMail className="text-content-muted" />
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="Email"
              className="input-field"
            />
          </div>
          <div className="input-container flex items-center gap-3">
            <FiPhone className="text-content-muted" />
            <input
              type="number"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              placeholder="Phone"
              className="input-field"
            />
          </div>
        </div>
        <p className="text-xs text-content-muted mt-2">Enter either your registered email or phone number.</p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2 text-content-muted">Product ID</label>
        <div className="input-container flex items-center gap-3">
          <FiKey className="text-content-muted" />
          <input
            type="text"
            name="productId"
            value={formData.productId}
            onChange={handleChange}
            placeholder="Enter your Product ID (e.g. KK-XXXX)"
            className="input-field uppercase"
            required
          />
        </div>
        <p className="text-xs text-content-muted mt-2">Your Product ID is printed on the welcome letter you received with your subscription.</p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2 text-content-muted">Password</label>
        <div className="input-container flex items-center gap-3">
          <FiLock className="text-content-muted" />
          <input
            type={showPassword ? "text" : "password"}
            name="password"
            value={formData.password}
            onChange={handleChange}
            placeholder="Enter password"
            className="input-field"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="text-content-muted hover:text-content text-sm font-semibold"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowForgotPassword(true)}
          className="text-xs text-accent hover:underline font-medium link-underline"
        >
          Forgot password?
        </button>
      </div>

      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        type="submit"
        disabled={loginMutation.isPending || (!formData.email && !formData.phone) || !formData.productId}
        className="btn-primary w-full !py-3.5 text-base disabled:opacity-50"
      >
        {loginMutation.isPending ? "Signing in..." : "Sign In"}
      </motion.button>

      {/* Forgot Password Modal */}
      <AnimatePresence>
        {showForgotPassword && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => {
              setShowForgotPassword(false);
              setResetSent(false);
              setForgotEmail("");
            }}
          >
            <motion.div
              initial={{ y: 50, opacity: 0, scale: 0.95 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 50, opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface-secondary rounded-2xl p-6 shadow-2xl border border-border w-full max-w-md"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-xl font-bold">Forgot Password</h3>
                <button
                  onClick={() => {
                    setShowForgotPassword(false);
                    setResetSent(false);
                    setForgotEmail("");
                  }}
                  className="p-2 rounded-full hover:bg-surface-tertiary"
                >
                  <FiX size={20} />
                </button>
              </div>

              {!resetSent ? (
                <>
                  <p className="text-sm text-content-muted mb-4">
                    Enter your registered email address. We will send you instructions to reset your password.
                  </p>
                  <div className="input-container flex items-center gap-3 mb-4">
                    <FiMail className="text-content-muted" />
                    <input
                      type="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="Enter your email"
                      className="input-field"
                    />
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      if (!forgotEmail) {
                        enqueueSnackbar("Please enter your email address!", { variant: "warning" });
                        return;
                      }
                      setResetSent(true);
                      enqueueSnackbar("Password reset link sent to your email!", { variant: "success" });
                    }}
                    className="btn-primary w-full !py-3 text-base flex items-center justify-center gap-2"
                  >
                    <FiSend size={16} /> Send Reset Link
                  </motion.button>
                </>
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-center py-4"
                >
                  <div className="w-16 h-16 mx-auto bg-accent-green/20 rounded-full flex items-center justify-center mb-3">
                    <FiSend className="text-accent-green" size={28} />
                  </div>
                  <h4 className="font-semibold text-lg mb-1">Check Your Email!</h4>
                  <p className="text-sm text-content-muted mb-4">
                    Password reset instructions have been sent to <span className="font-semibold text-content">{forgotEmail}</span>
                  </p>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      setShowForgotPassword(false);
                      setResetSent(false);
                      setForgotEmail("");
                    }}
                    className="btn-secondary w-full !py-3"
                  >
                    Back to Login
                  </motion.button>
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
};

export default Login;