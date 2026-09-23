import React, { useEffect, useState } from "react";
import SecurityPinModal from "./SecurityPinModal";
import { onPinRequest } from "../../utils/pinPrompt";

/** The popup behind utils/pinPrompt.js; mounted once in App. */
const GlobalPinPrompt = () => {
  const [request, setRequest] = useState(null);
  useEffect(() => onPinRequest(setRequest), []);
  if (!request) return null;
  return (
    <SecurityPinModal
      isOpen
      onSuccess={() => {
        request.resolve();
        setRequest(null);
      }}
      // Also called right after onSuccess; rejecting a settled promise does nothing.
      onClose={() => {
        request.reject(new Error("PIN entry cancelled."));
        setRequest(null);
      }}
    />
  );
};

export default GlobalPinPrompt;
