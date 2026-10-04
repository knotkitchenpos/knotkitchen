import React from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { getKnotEats, setKnotEatsEnabled } from "../../https/eatsApi";
import { isOwner } from "../../utils/security";

/**
 * Where each blocker is fixed. The message comes from the server
 * (knotEats.BLOCKER_MESSAGES); an unknown code shows its message with no link.
 * NO_MENU points at Manage Website because "Publish Website" there is what
 * puts the menu on the website, which is what Knot Eats lists.
 */
const FIX_PATH = {
  WEBSITE_OFF: "/website",
  NO_GATEWAY: "/website",
  NO_MENU: "/website",
  NO_WEBSITE_ADDON: "/settings/billing",
  ACCOUNT_LOCKED: "/settings/billing",
  NO_PIN: "/settings?view=properties",
  NO_ORDER_TYPE: "/settings?view=toggles",
  STORE_STATUS: "/support",
  DELISTED: "/support",
};

const linkCls = "text-[12.5px] font-bold text-[#C2410C] underline underline-offset-2 shrink-0";

const Row = ({ label, value, to }) => (
  <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[13px]">
    <div className="min-w-0">
      <p className="text-[11.5px] font-bold text-[#94A3B8]">{label}</p>
      <p className="font-bold text-[#0F172A] truncate">{value}</p>
    </div>
    {to ? <Link to={to} className={linkCls}>Change</Link> : null}
  </div>
);

/* ---------- Knot Eats: opt in to eats.<base> ---------- */
const KnotEatsView = () => {
  const qc = useQueryClient();
  const user = useSelector((s) => s.user);
  const owner = isOwner(user);
  const { data: res, isLoading, isError } = useQuery({ queryKey: ["knot-eats"], queryFn: getKnotEats });
  const k = res?.data?.data;
  // CSD "Open POS" signs in as the owner, but the switch is the owner's own consent to the fee (D14). The server refuses it too.
  const support = Boolean(k?.supportSession);

  const mut = useMutation({
    mutationFn: (enabled) => setKnotEatsEnabled(enabled),
    // The PUT answers with the GET shape, blockers included.
    onSuccess: (r, enabled) => {
      qc.setQueryData(["knot-eats"], r);
      enqueueSnackbar(enabled ? "Knot Eats turned on." : "Knot Eats turned off.", { variant: "success" });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed", { variant: "error" }),
  });

  if (isLoading) return <div className="p-8 text-center text-[#94A3B8]">Loading…</div>;
  if (isError || !k) return <div className="p-8 text-center text-[#94A3B8]">Couldn&apos;t load Knot Eats. Try again in a moment.</div>;

  const fee = k.fee;
  const feeFrom = fee?.startsAt && new Date(fee.startsAt) > new Date() ? new Date(fee.startsAt) : null;
  const pill = k.delisted
    ? { text: "Delisted by KnotKitchen", cls: "bg-[#FEF2F2] text-[#DC2626]" }
    : k.listed
      ? { text: "Live", cls: "bg-[#DCFCE7] text-[#15803D]" }
      : { text: "Not live", cls: "bg-[#F1F5F9] text-[#475569]" };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(k.publicUrl);
      enqueueSnackbar("Link copied.", { variant: "success" });
    } catch {
      enqueueSnackbar("Couldn't copy. Select the link and copy it.", { variant: "warning" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-[15px] font-extrabold text-[#0F172A]">Knot Eats listing</h4>
          <span className={`px-3 py-1 rounded-full text-[12px] font-bold ${pill.cls}`}>{pill.text}</span>
        </div>
        {k.delisted && (
          <p className="text-[12.5px] text-[#334155]">
            {k.delistedReason ? `Reason: ${k.delistedReason} ` : ""}
            <Link to="/support" className={linkCls}>Contact support</Link>
          </p>
        )}

        {/* The fee is shown here because opting in is consent to it. */}
        <p className="text-[12.5px] text-[#334155] rounded-xl bg-[#FFF7ED] border border-[#FED7AA] p-3">
          {fee
            ? `Each Knot Eats order adds a ₹${fee.amount}${fee.taxable === false ? "" : " + GST"} Platform fee to the customer's bill. The same amount is deducted from your wallet when they pay, and returned if the order is cancelled.${
                feeFrom ? ` From ${feeFrom.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}.` : ""
              }`
            : "No Knot Eats fee is charged yet."}
        </p>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13.5px] font-extrabold text-[#0F172A]" id="ke-switch-label">List my restaurant on Knot Eats</p>
            {support ? (
              <p className="text-[11.5px] text-[#94A3B8]">Support session: only the owner can switch Knot Eats on or off, from their own sign-in.</p>
            ) : (
              !owner && <p className="text-[11.5px] text-[#94A3B8]">Only the owner can change this.</p>
            )}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(k.enabled)}
            aria-labelledby="ke-switch-label"
            disabled={!owner || support || mut.isPending}
            onClick={() => mut.mutate(!k.enabled)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${k.enabled ? "bg-[#22C55E]" : "bg-[#CBD5E1]"}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${k.enabled ? "left-6" : "left-1"}`} />
          </button>
        </div>

        {k.blockers?.length > 0 && (
          <div className="pt-3 border-t border-[#E2E8F0] space-y-2">
            <p className="text-[12.5px] font-bold text-[#334155]">
              {k.enabled ? "Your restaurant goes live once these are done:" : "Before you go live:"}
            </p>
            <ul className="space-y-2">
              {k.blockers.map((b) => (
                <li key={b.code} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[13px]">
                  <span className="font-bold text-[#0F172A]">{b.message || b.code}</span>
                  {FIX_PATH[b.code] ? <Link to={FIX_PATH[b.code]} className={linkCls}>Fix</Link> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-3">
        <h4 className="text-[15px] font-extrabold text-[#0F172A]">Location & delivery</h4>
        <p className="text-[12px] text-[#94A3B8]">Shared with your website. Knot Eats shows your restaurant to customers within your delivery radius.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Row label="Map pin" value={k.pin ? `${k.pin.lat}, ${k.pin.lng}` : "Not set"} to="/settings?view=properties" />
          <Row label="Delivery radius (Max Distance)" value={`${k.radiusKm ?? 7} km`} to="/settings?view=rules" />
          <Row label="Rating" value={k.rating != null ? `${k.rating} ★ (${k.ratingCount})` : "No ratings yet"} />
        </div>
      </div>

      {k.listed && k.publicUrl && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-3">
          <h4 className="text-[15px] font-extrabold text-[#0F172A]">Your Knot Eats page</h4>
          <p className="text-[13px] font-bold text-[#334155] break-all select-all">{k.publicUrl}</p>
          <div className="flex gap-2">
            <button type="button" onClick={copyUrl} className="h-[36px] px-3.5 rounded-xl border border-[#E2E8F0] text-[12.5px] font-bold text-[#334155]">
              Copy
            </button>
            <a href={k.publicUrl} target="_blank" rel="noreferrer" className="h-[36px] px-3.5 rounded-xl bg-[#FD5302] text-white text-[12.5px] font-bold flex items-center">
              Open
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default KnotEatsView;
