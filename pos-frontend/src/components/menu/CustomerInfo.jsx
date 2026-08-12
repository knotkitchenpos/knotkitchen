import React, { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { formatDate, getAvatarName } from "../../utils";
import { setCustomer, removeCustomer } from "../../redux/slices/customerSlice";
import { FiEdit2, FiX } from "react-icons/fi";

const CustomerInfo = () => {
  const [dateTime, setDateTime] = useState(new Date());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const customerData = useSelector((state) => state.customer);
  const orderType = useSelector((state) => state.orderType.orderType);
  const dispatch = useDispatch();

  const [name, setName] = useState(customerData.customerName || "");
  const [phone, setPhone] = useState(customerData.customerPhone || "");

  useEffect(() => {
    setName(customerData.customerName || "");
    setPhone(customerData.customerPhone || "");
  }, [customerData.customerName, customerData.customerPhone]);

  useEffect(() => {
    const timer = setInterval(() => setDateTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date) =>
    `${String(date.getHours()).padStart(2, "0")}:${String(
      date.getMinutes()
    ).padStart(2, "0")}`;

  const handleSave = (e) => {
    e.preventDefault();
    dispatch(setCustomer({ name: name.trim(), phone: phone.trim(), guests: customerData.guests || 1 }));
    setIsModalOpen(false);
  };

  const handleClear = () => {
    setName("");
    setPhone("");
    dispatch(removeCustomer());
    setIsModalOpen(false);
  };

  const displayName = customerData.customerName || "Walk-in Customer";
  const displayPhone = customerData.customerPhone ? customerData.customerPhone : null;

  return (
    <>
      <div className="flex items-center justify-between bg-surface-input rounded-2xl border border-border p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full bg-gradient-brand flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            {getAvatarName(displayName) || "WC"}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-content truncate">
                {displayName}
              </h1>
              <button
                onClick={() => setIsModalOpen(true)}
                className="text-content-muted hover:text-accent p-1 transition-colors"
                title="Edit customer info (Optional for collection)"
              >
                <FiEdit2 size={14} />
              </button>
            </div>
            <p className="text-xs text-content-muted truncate">
              {displayPhone ? `Phone: ${displayPhone} / ` : ""}
              {orderType}
            </p>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs font-semibold text-accent">{formatTime(dateTime)}</p>
          <p className="text-[10px] text-content-muted">{formatDate(dateTime)}</p>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface-secondary p-6 rounded-2xl shadow-2xl w-full max-w-md border border-border">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-content text-lg font-semibold font-display">Customer Information</h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-content-muted hover:text-accent-red text-xl leading-none p-1"
              >
                <FiX />
              </button>
            </div>
            <p className="text-xs text-content-muted mb-4">
              Customer details are optional for Collection orders. Fill in name/phone to save customer to CRM.
            </p>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-content-muted mb-1 text-xs font-medium">Customer Name (Optional)</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full bg-surface-input border border-border rounded-xl p-3 text-sm text-content focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-content-muted mb-1 text-xs font-medium">Phone Number (Optional)</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                  className="w-full bg-surface-input border border-border rounded-xl p-3 text-sm text-content focus:outline-none focus:border-accent"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleClear}
                  className="flex-1 py-2.5 rounded-xl border border-border bg-surface-input text-content-muted text-sm font-semibold hover:bg-surface-tertiary"
                >
                  Clear
                </button>
                <button
                  type="submit"
                  className="flex-1 btn-primary !py-2.5 text-sm"
                >
                  Save Details
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default CustomerInfo;
