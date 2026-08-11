import React, { useState, useEffect } from "react";
import { useSelector } from "react-redux";
import { formatDate, getAvatarName } from "../../utils";

const CustomerInfo = () => {
  const [dateTime, setDateTime] = useState(new Date());
  const customerData = useSelector((state) => state.customer);

  useEffect(() => {
    const timer = setInterval(() => setDateTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date) =>
    `${String(date.getHours()).padStart(2, "0")}:${String(
      date.getMinutes()
    ).padStart(2, "0")}`;

  return (
    <div className="flex items-center justify-between bg-surface-input rounded-2xl border border-border p-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-11 h-11 rounded-full bg-gradient-brand flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
          {getAvatarName(customerData.customerName) || "CN"}
        </div>
        <div className="min-w-0">
          <h1 className="font-semibold text-content truncate">
            {customerData.customerName || "Customer Name"}
          </h1>
          <p className="text-xs text-content-muted truncate">
            #{customerData.orderId || "N/A"} / Dine in
          </p>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xs font-semibold text-accent">{formatTime(dateTime)}</p>
        <p className="text-[10px] text-content-muted">{formatDate(dateTime)}</p>
      </div>
    </div>
  );
};

export default CustomerInfo;