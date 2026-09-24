import React, { useState } from "react";
import { useSelector } from "react-redux";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { publishSystemCache } from "../../https";
import SecurityPinModal from "../common/SecurityPinModal";
import { checkActionAuthorization } from "../../utils/security";
import { checkMenuNow, readSavedMenu } from "../../utils/systemMenu";
import { dateGB, time12 } from "../../utils";

/* ---------- The menu kept on this device ---------- */
const DeviceMenuCard = () => {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(() => readSavedMenu());
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const res = await checkMenuNow(queryClient);
      if (res.offline) {
        enqueueSnackbar("No internet. This device keeps using its saved menu.", { variant: "warning" });
      } else {
        enqueueSnackbar(res.changed ? "Menu updated on this device." : "Menu is up to date.", { variant: "success" });
      }
    } catch (err) {
      enqueueSnackbar(err?.response?.data?.message || "Could not check for menu updates.", { variant: "error" });
    } finally {
      setSaved(readSavedMenu());
      setChecking(false);
    }
  };

  const products = (saved?.body?.data || []).reduce((n, m) => n + (m?.items?.length || 0), 0);
  const when = (t) => (t ? `${dateGB(t)}, ${time12(t)}` : "—");

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-[15px] font-extrabold text-[#0F172A]">Menu on this device</h4>
        </div>
        <button
          onClick={check}
          disabled={checking}
          className="h-[40px] px-4 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold shrink-0 hover:bg-[#D64502] disabled:opacity-50"
        >
          {checking ? "Checking…" : "Check for updates"}
        </button>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[12.5px]">
        <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2">
          <dt className="text-[#64748B]">Saved menu</dt>
          <dd className="font-bold text-[#0F172A]">{saved?.body ? `${products} products` : "Not saved yet"}</dd>
          <dd className="text-[#94A3B8]">{when(saved?.savedAt)}</dd>
        </div>
        <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2">
          <dt className="text-[#64748B]">Last checked</dt>
          <dd className="font-bold text-[#0F172A]">{when(saved?.checkedAt)}</dd>
        </div>
        <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2">
          <dt className="text-[#64748B]">Photos saved</dt>
          <dd className="font-bold text-[#0F172A]">
            {saved?.photos ? `${saved.photos.saved} of ${saved.photos.total}` : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
};

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
      <DeviceMenuCard />

      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 pt-1">
          <div>
            <h4 className="text-[15px] font-extrabold text-[#0F172A]">Update POS Cache</h4>
            <p className="text-[12.5px] text-[#64748B] mt-0.5">
              Publish Menu changes to the POS
            </p>
          </div>
          <button
            onClick={() => executeProtected(() => sysMutation.mutate())}
            disabled={sysMutation.isPending}
            className="h-[40px] px-4 rounded-xl border border-[#FD5302] text-[#C2410C] text-[13px] font-bold shrink-0 hover:bg-[#FFF1E8] disabled:opacity-50"
          >
            {sysMutation.isPending ? "Publishing…" : "Publish POS"}
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
