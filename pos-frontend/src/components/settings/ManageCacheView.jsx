import React, { useState } from "react";
import { useSelector } from "react-redux";
import { useMutation } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { publishSystemCache } from "../../https";
import SecurityPinModal from "../common/SecurityPinModal";
import { checkActionAuthorization } from "../../utils/security";

/* ---------- Manage Cache ---------- */
const ManageCacheView = () => {
  const user = useSelector((state) => state.user);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  // Publishing is a protected action: the owner passes straight through,
  // a staff member is asked for the Security PIN first.
  const executeProtected = (actionFn) => {
    const auth = checkActionAuthorization(user, { isOwnerOnly: false });
    if (auth.status === "REQUIRE_PIN") {
      setPendingAction(() => actionFn);
      setPinModalOpen(true);
      return;
    }
    actionFn();
  };

  const sysMutation = useMutation({
    mutationFn: publishSystemCache,
    onSuccess: (res) => enqueueSnackbar(res.data?.message || "System cache updated", { variant: "success" }),
    onError: (err) => enqueueSnackbar(err.response?.data?.message || "Failed to publish system cache", { variant: "error" }),
  });

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[#64748B] leading-relaxed">
        The POS tills and your customer website keep serving the last published copy of the menu
        and of Manage Website, so prices cannot change under a cashier or a customer mid-order.
        Edits in Manage Menu and Manage Website stay as drafts until you publish here.
      </p>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 pt-1">
          <div>
            <h4 className="text-[15px] font-extrabold text-[#0F172A]">Update System Cache</h4>
            <p className="text-[12.5px] text-[#64748B] mt-0.5">
              Publishes Manage Menu and Manage Website changes to the POS tills and the customer website.
            </p>
          </div>
          <button
            onClick={() => executeProtected(() => sysMutation.mutate())}
            disabled={sysMutation.isPending}
            className="h-[40px] px-4 rounded-xl border border-[#FD5302] text-[#C2410C] text-[13px] font-bold shrink-0 hover:bg-[#FFF1E8] disabled:opacity-50"
          >
            {sysMutation.isPending ? "Publishing…" : "Publish System"}
          </button>
        </div>
      </div>

      <SecurityPinModal
        isOpen={pinModalOpen}
        onClose={() => {
          setPinModalOpen(false);
          setPendingAction(null);
        }}
        onSuccess={() => {
          setPinModalOpen(false);
          if (pendingAction) pendingAction();
          setPendingAction(null);
        }}
        title="Publish requires authorization"
        actionLabel="Publish"
      />
    </div>
  );
};

export default ManageCacheView;
