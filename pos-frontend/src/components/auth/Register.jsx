import { useState } from "react";
import { motion } from "framer-motion";
import { FiUser, FiMail, FiPhone, FiLock, FiMapPin, FiKey, FiBriefcase, FiFileText, FiHash } from "react-icons/fi";
import { register } from "../../https";
import { useMutation } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { useDispatch } from "react-redux";
import { setUser } from "../../redux/slices/userSlice";
import { useNavigate } from "react-router-dom";

const Register = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    email: "",
    phone: "",
    password: "",
    productId: "",
    restaurantName: "",
    legalName: "",
    registrationNumber: "",
    taxId: "",
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.productId || !formData.productId.trim()) {
      enqueueSnackbar("Product ID is required!", { variant: "error" });
      return;
    }
    registerMutation.mutate(formData);
  };

  const registerMutation = useMutation({
    mutationFn: (reqData) => register(reqData),
    onSuccess: (res) => {
      const { data } = res;
      enqueueSnackbar(data.message, { variant: "success" });
      const { _id, name, address, email, phone, role } = data.data;
      dispatch(setUser({ _id, name, address, email, phone, role }));
      setFormData({
        name: "",
        address: "",
        email: "",
        phone: "",
        password: "",
        productId: "",
        restaurantName: "",
        legalName: "",
        registrationNumber: "",
        taxId: "",
      });

      setTimeout(() => {
        navigate("/");
      }, 1500);
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
      {/* ===== Product ID (required — gate for signup) ===== */}
      <div className="rounded-lg border border-accent/20 bg-accent/5 p-3">
        <label className="block text-sm font-medium mb-2 text-content-muted">Product ID (Required)</label>
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
        <p className="text-xs text-content-muted mt-2">
          You cannot sign up without a valid, active Product ID. Contact sales if you do not have one.
        </p>
      </div>

      {/* ===== Restaurant / Business Information ===== */}
      <div className="pt-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-content-muted mb-2">Business Information</p>
        <div>
          <label className="block text-sm font-medium mb-2 text-content-muted">Restaurant / Business Name</label>
          <div className="input-container flex items-center gap-3">
            <FiBriefcase className="text-content-muted" />
            <input
              type="text"
              name="restaurantName"
              value={formData.restaurantName}
              onChange={handleChange}
              placeholder="Enter your restaurant business name"
              className="input-field"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2 text-content-muted">Legal Name</label>
          <div className="input-container flex items-center gap-3">
            <FiFileText className="text-content-muted" />
            <input
              type="text"
              name="legalName"
              value={formData.legalName}
              onChange={handleChange}
              placeholder="Registered legal name (optional)"
              className="input-field"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm font-medium mb-2 text-content-muted">Registration No.</label>
            <div className="input-container flex items-center gap-3">
              <FiFileText className="text-content-muted" />
              <input
                type="text"
                name="registrationNumber"
                value={formData.registrationNumber}
                onChange={handleChange}
                placeholder="Business reg. no."
                className="input-field"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 text-content-muted">Tax ID (GST/VAT)</label>
            <div className="input-container flex items-center gap-3">
              <FiHash className="text-content-muted" />
              <input
                type="text"
                name="taxId"
                value={formData.taxId}
                onChange={handleChange}
                placeholder="GST / VAT"
                className="input-field"
              />
            </div>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2 text-content-muted">Address</label>
        <div className="input-container flex items-center gap-3">
          <FiMapPin className="text-content-muted" />
          <input
            type="text"
            name="address"
            value={formData.address}
            onChange={handleChange}
            placeholder="Enter restaurant address"
            className="input-field"
            required
          />
        </div>
      </div>

      {/* ===== Admin / User Information ===== */}
      <div className="pt-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-content-muted mb-2">Admin Account</p>
        <div>
          <label className="block text-sm font-medium mb-2 text-content-muted">Your Name</label>
          <div className="input-container flex items-center gap-3">
            <FiUser className="text-content-muted" />
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Enter your full name"
              className="input-field"
              required
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm font-medium mb-2 text-content-muted">Email (optional)</label>
            <div className="input-container flex items-center gap-3">
              <FiMail className="text-content-muted" />
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="Enter email address"
                className="input-field"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2 text-content-muted">Phone Number</label>
            <div className="input-container flex items-center gap-3">
              <FiPhone className="text-content-muted" />
              <input
                type="number"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="10-digit phone number"
                className="input-field"
                required
              />
            </div>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2 text-content-muted">Password</label>
        <div className="input-container flex items-center gap-3">
          <FiLock className="text-content-muted" />
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            placeholder="Enter password"
            className="input-field"
            required
          />
        </div>
      </div>

      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        type="submit"
        disabled={registerMutation.isPending || !formData.productId.trim()}
        className="btn-primary w-full !py-3.5 text-base disabled:opacity-50"
      >
        {registerMutation.isPending ? "Creating Account..." : "Register Account"}
      </motion.button>
    </form>
  );
};

export default Register;