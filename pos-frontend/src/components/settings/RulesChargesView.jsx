import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { getWebsiteSettings, updateWebsiteSettings } from "../../https/storefrontApi";
import { fieldErrorLines } from "../../utils/rulesCharges";

/* ---------- Module 8: Rules, Charges & Promotions ---------- */
// The form mounts only once settings are loaded, and remounts on every new
// version. Each Add or Remove sends the stored list plus or minus one row,
// never a list built before the load finished (which wiped the saved rules).
const RulesChargesView = () => {
  const { data: webRes, isError } = useQuery({ queryKey: ["website", "settings"], queryFn: getWebsiteSettings });
  if (!webRes) {
    return (
      <div className="p-8 text-center text-[#94A3B8]">
        {isError ? "Couldn't load your settings. Try again in a moment." : "Loading…"}
      </div>
    );
  }
  const settings = webRes.data?.data?.settings || {};
  return <RulesChargesForm key={settings.version} settings={settings} />;
};

const COUPON_CODE = /^[A-Z0-9]{3,20}$/;

const RulesChargesForm = ({ settings }) => {
  const qc = useQueryClient();
  const ordering = settings.ordering || {};

  const [gstApply, setGstApply] = useState(ordering.gstApplyTo || "both");
  // The rate itself had no field anywhere, so GST could never be configured
  // -- which is why a hardcoded 5% was being charged instead.
  const [gstPercent, setGstPercent] = useState(
    ordering.taxPercent === undefined || ordering.taxPercent === null
      ? ""
      : String(ordering.taxPercent),
  );
  const [taxInclusive, setTaxInclusive] = useState(ordering.taxInclusive === true);
  const [serviceCharge, setServiceCharge] = useState(
    ordering.serviceChargePercent ? String(ordering.serviceChargePercent) : "",
  );
  const [packingFee, setPackingFee] = useState(ordering.packagingFee ? String(ordering.packagingFee) : "");
  const [maxDist, setMaxDist] = useState(ordering.deliverySlabsConfig?.maxDistanceKm ?? 7);
  // The lists are what the server saved. They change only when a save
  // succeeds: its answer becomes the new version and remounts this form.
  const slabs = ordering.deliverySlabsConfig?.slabs || [];
  const coupons = settings.couponsConfig || [];
  const freeRules = settings.freeItemConfig || [];
  const [sMin, setSMin] = useState(""); const [sMax, setSMax] = useState(""); const [sFee, setSFee] = useState("");
  const [cCode, setCCode] = useState(""); const [cType, setCType] = useState("percent"); const [cVal, setCVal] = useState(""); const [cMin, setCMin] = useState("");
  const [fName, setFName] = useState(""); const [fMin, setFMin] = useState("");
  const [failed, setFailed] = useState(null); // { section, lines } from the last rejected save

  const mut = useMutation({
    mutationFn: ({ body }) => updateWebsiteSettings(body),
    onMutate: () => setFailed(null),
    // The PUT answers with the GET shape.
    onSuccess: (res) => { enqueueSnackbar("Saved!", { variant: "success" }); qc.setQueryData(["website", "settings"], res); },
    onError: (e, { section, body }) => {
      setFailed({ section, lines: fieldErrorLines(e.response?.data?.fieldErrors, body) });
      enqueueSnackbar(e.response?.data?.message || "Failed", { variant: "error" });
    },
  });
  const save = (section, body) => mut.mutate({ section, body });
  const errors = (section) =>
    failed?.section === section && failed.lines.length > 0 ? (
      <ul className="space-y-1 text-[12px] font-bold text-[#DC2626]">{failed.lines.map((l) => <li key={l}>{l}</li>)}</ul>
    ) : null;

  const saveSlabs = (u) => save("slabs", { ordering: { deliverySlabsConfig: { maxDistanceKm: +maxDist || 7, slabs: u } } });
  const addCoupon = () => {
    const code = cCode.toUpperCase().trim();
    if (!code || !cVal) { enqueueSnackbar("Code & value required", { variant: "warning" }); return; }
    if (!COUPON_CODE.test(code)) { enqueueSnackbar("Use 3 to 20 letters or digits for the code, no spaces or symbols.", { variant: "warning" }); return; }
    if (coupons.some((c) => c.code === code)) { enqueueSnackbar(`The code "${code}" is already used.`, { variant: "warning" }); return; }
    if (!(+cVal > 0) || (cType === "percent" && +cVal > 100)) { enqueueSnackbar(cType === "percent" ? "Enter a percentage above 0, up to 100." : "Enter an amount above zero.", { variant: "warning" }); return; }
    save("coupons", { couponsConfig: [...coupons, { code, type: cType, value: +cVal, minOrderAmount: +cMin || 0, isActive: true }] });
  };

  return (
    <div className="space-y-6">
      {/* §3 GST & Packing */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <h4 className="text-[15px] font-extrabold text-[#0F172A]">GST & Packing</h4>
        <p className="text-[12px] text-[#94A3B8]">
          GST is charged only when this store has a GST Number saved under Store
          Properties <span className="font-bold">and</span> a rate above 0 here.
          Leave the rate at 0 to charge no GST.
        </p>
        <div className="grid grid-cols-2 gap-4 text-[13px]">
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">GST rate (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={gstPercent}
              onChange={(e) => setGstPercent(e.target.value)}
              placeholder="0 (no GST)"
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Price includes GST</label>
            <select
              value={taxInclusive ? "yes" : "no"}
              onChange={(e) => setTaxInclusive(e.target.value === "yes")}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold"
            >
              <option value="no">No, add GST on top</option>
              <option value="yes">Yes, prices already include it</option>
            </select>
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">GST applies to</label>
            <select value={gstApply} onChange={(e)=>setGstApply(e.target.value)} className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold">
              <option value="both">Both</option><option value="website">Website</option><option value="system">System</option>
            </select>
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Service charge on table bills (%)</label>
            <input
              type="number"
              min={0}
              max={25}
              step="0.5"
              value={serviceCharge}
              onChange={(e) => setServiceCharge(e.target.value)}
              placeholder="0 (none)"
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold"
            />
            <p className="mt-1 text-[11px] text-[#94A3B8]">Dine-in only, added on the bill after discount and tax. Shown as its own line; it can be removed when the table pays.</p>
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Packing charge on website orders (₹)</label>
            <input
              type="number"
              min={0}
              step="1"
              value={packingFee}
              onChange={(e) => setPackingFee(e.target.value)}
              placeholder="0 (none)"
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold"
            />
            <p className="mt-1 text-[11px] text-[#94A3B8]">Website orders only. Never added to till, table or QR bills.</p>
          </div>
        </div>
        {errors("gst")}
        <div className="flex justify-end">
          <button
            onClick={() =>
              save("gst", {
                ordering: {
                  gstApplyTo: gstApply,
                  packagingFee: Math.max(0, Number(packingFee) || 0),
                  taxPercent: Math.min(100, Math.max(0, Number(gstPercent) || 0)),
                  taxInclusive,
                  serviceChargePercent: Math.min(25, Math.max(0, Number(serviceCharge) || 0)),
                },
              })
            }
            disabled={mut.isPending}
            className="h-[38px] px-4 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold"
          >
            Save
          </button>
        </div>
      </div>

      {/* §2 Delivery Distance Slabs */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <h4 className="text-[15px] font-extrabold text-[#0F172A]">Delivery Distance Slabs</h4>
        <p className="text-[12px] text-[#94A3B8]">Distance calculated server-side. Orders beyond max distance are rejected.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[13px] items-end">
          <div><label className="text-[11px] font-bold text-[#94A3B8]">Max Distance (km)</label><input type="number" min={0} value={maxDist} onChange={(e)=>setMaxDist(e.target.value)} className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"/></div>
          <div><label className="text-[11px] font-bold text-[#94A3B8]">Min km</label><input type="number" value={sMin} onChange={(e)=>setSMin(e.target.value)} placeholder="0" className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"/></div>
          <div><label className="text-[11px] font-bold text-[#94A3B8]">Max km</label><input type="number" value={sMax} onChange={(e)=>setSMax(e.target.value)} placeholder="3" className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"/></div>
          <div className="flex gap-2"><div className="flex-1"><label className="text-[11px] font-bold text-[#94A3B8]">Fee ₹</label><input type="number" value={sFee} onChange={(e)=>setSFee(e.target.value)} placeholder="30" className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"/></div>
            <button onClick={()=>{if(!sMin||!sMax||!sFee){enqueueSnackbar("Fill all slab fields",{variant:"warning"});return;}saveSlabs([...slabs,{minKm:+sMin,maxKm:+sMax,fee:+sFee}]);}} disabled={mut.isPending} className="mt-5 h-[36px] px-3 rounded-xl bg-[#FD5302] text-white text-[12px] font-bold shrink-0">Add</button>
          </div>
        </div>
        {errors("slabs")}
        {slabs.length>0&&<div className="pt-2 border-t border-[#E2E8F0] space-y-2 text-[13px]">{slabs.map((s,i)=><div key={i} className="flex justify-between p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]"><span className="font-bold">{s.minKm}–{s.maxKm} km → ₹{s.fee}</span><button onClick={()=>saveSlabs(slabs.filter((_,j)=>j!==i))} disabled={mut.isPending} className="text-[#DC2626] font-bold text-[12px]">Remove</button></div>)}</div>}
      </div>

      {/* §5 Coupons */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <h4 className="text-[15px] font-extrabold text-[#0F172A]">Website Coupons</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[13px] items-end">
          <div><label className="text-[11px] font-bold text-[#94A3B8]">Code</label><input value={cCode} onChange={(e)=>setCCode(e.target.value)} placeholder="WELCOME10" className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold uppercase"/></div>
          <div><label className="text-[11px] font-bold text-[#94A3B8]">Type</label><select value={cType} onChange={(e)=>setCType(e.target.value)} className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"><option value="percent">%</option><option value="fixed">₹</option></select></div>
          <div><label className="text-[11px] font-bold text-[#94A3B8]">Value</label><input type="number" value={cVal} onChange={(e)=>setCVal(e.target.value)} className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"/></div>
          <div className="flex gap-2"><div className="flex-1"><label className="text-[11px] font-bold text-[#94A3B8]">Min Order ₹</label><input type="number" value={cMin} onChange={(e)=>setCMin(e.target.value)} className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"/></div>
            <button onClick={addCoupon} disabled={mut.isPending} className="mt-5 h-[36px] px-3 rounded-xl bg-[#FD5302] text-white text-[12px] font-bold shrink-0">Add</button>
          </div>
        </div>
        {errors("coupons")}
        {coupons.length>0&&<div className="pt-2 border-t border-[#E2E8F0] space-y-2 text-[13px]">{coupons.map((c,i)=><div key={i} className="flex justify-between p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]"><span className="font-bold">{c.code} → {c.type==="percent"?`${c.value}%`:`₹${c.value}`} (min ₹{c.minOrderAmount||0})</span><button onClick={()=>save("coupons",{couponsConfig:coupons.filter((_,j)=>j!==i)})} disabled={mut.isPending} className="text-[#DC2626] font-bold text-[12px]">Remove</button></div>)}</div>}
      </div>

      {/* §6 Free Item */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <h4 className="text-[15px] font-extrabold text-[#0F172A]">Free Item Promotions</h4>
        <p className="text-[12px] text-[#94A3B8]">Server-side only. Price forced to ₹0. Shown on receipt.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[13px] items-end">
          <div><label className="text-[11px] font-bold text-[#94A3B8]">Item Name</label><input value={fName} onChange={(e)=>setFName(e.target.value)} placeholder="Free Gulab Jamun" className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"/></div>
          <div><label className="text-[11px] font-bold text-[#94A3B8]">Min Order ₹</label><input type="number" value={fMin} onChange={(e)=>setFMin(e.target.value)} placeholder="500" className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"/></div>
          <button onClick={()=>{if(!fName){enqueueSnackbar("Item name required",{variant:"warning"});return;}save("free",{freeItemConfig:[...freeRules,{itemName:fName.trim(),minOrderAmount:+fMin||0,applyTo:"both",isActive:true}]});}} disabled={mut.isPending} className="col-span-2 sm:col-span-1 h-[36px] px-4 rounded-xl bg-[#FD5302] text-white text-[12px] font-bold">Add Rule</button>
        </div>
        {errors("free")}
        {freeRules.length>0&&<div className="pt-2 border-t border-[#E2E8F0] space-y-2 text-[13px]">{freeRules.map((r,i)=><div key={i} className="flex justify-between p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]"><span className="font-bold">{r.itemName} (min ₹{r.minOrderAmount||0})</span><button onClick={()=>save("free",{freeItemConfig:freeRules.filter((_,j)=>j!==i)})} disabled={mut.isPending} className="text-[#DC2626] font-bold text-[12px]">Remove</button></div>)}</div>}
      </div>

      {/* §7 Promotion Priority */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 text-[13px] text-[#334155] space-y-2">
        <h4 className="text-[15px] font-extrabold text-[#0F172A]">Promotion Priority (Deterministic)</h4>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Item prices + Variants + Add-ons + Modifiers</li>
          <li>Free Item auto-injection (₹0)</li>
          <li>Discount / Coupon (clamped so total ≥ 0)</li>
          <li>Packing Charge</li>
          <li>GST / Tax</li>
          <li>Service charge (table bills only, on the bill after tax)</li>
          <li>Delivery Fee (distance slabs / max distance)</li>
          <li>Total = max(0, Subtotal − Discount + Packing + GST (only when prices exclude it) + Service charge + Delivery)</li>
        </ol>
      </div>
    </div>
  );
};

/* ---------- Main Settings layout (Module 6 & Module 7) ---------- */

export default RulesChargesView;
