import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { getStoreProperties, updateOrderToggles } from "../../https";
import { getWebsiteSettings, updateWebsiteSettings } from "../../https/storefrontApi";

/* ---------- Module 7 §4: Order Type Toggles & §5 Auto-Ready ---------- */
const OrderTypesAutoReadyView = () => {
  const qc = useQueryClient();
  const { data: propsRes } = useQuery({ queryKey: ["store-properties"], queryFn: getStoreProperties });
  const { data: webRes } = useQuery({ queryKey: ["website", "settings"], queryFn: getWebsiteSettings });

  const toggles = propsRes?.data?.data?.orderTypeToggles || { collection: true, delivery: true, table: true };
  const autoReady = webRes?.data?.data?.settings?.ordering?.autoReadyMinutes || { collection: 20, delivery: 45, table: 20 };

  const [colToggle, setColToggle] = useState(toggles.collection ?? true);
  const [delToggle, setDelToggle] = useState(toggles.delivery ?? true);
  const [tblToggle, setTblToggle] = useState(toggles.table ?? true);

  const [colAuto, setColAuto] = useState(autoReady.collection ?? 20);
  const [delAuto, setDelAuto] = useState(autoReady.delivery ?? 45);
  const [tblAuto, setTblAuto] = useState(autoReady.table ?? 20);

  // Auto-Complete Duration state
  const getPresetAndCustom = (val) => {
    const num = Number(val) || 0;
    if ([0, 15, 30, 60, 120].includes(num)) {
      return { preset: String(num), custom: "" };
    }
    return { preset: "custom", custom: String(num) };
  };

  const [colCompPreset, setColCompPreset] = useState("0");
  const [colCompCustom, setColCompCustom] = useState("");
  const [delCompPreset, setDelCompPreset] = useState("0");
  const [delCompCustom, setDelCompCustom] = useState("");
  const [tblCompPreset, setTblCompPreset] = useState("0");
  const [tblCompCustom, setTblCompCustom] = useState("");

  // Sync state when backend query data arrives asynchronously
  useEffect(() => {
    if (propsRes?.data?.data?.orderTypeToggles) {
      const t = propsRes.data.data.orderTypeToggles;
      setColToggle(t.collection ?? true);
      setDelToggle(t.delivery ?? true);
      setTblToggle(t.table ?? true);
    }
  }, [propsRes]);

  useEffect(() => {
    if (webRes?.data?.data?.settings?.ordering?.autoReadyMinutes) {
      const arm = webRes.data.data.settings.ordering.autoReadyMinutes;
      setColAuto(arm.collection ?? 20);
      setDelAuto(arm.delivery ?? 45);
      setTblAuto(arm.table ?? 20);
    }

    if (webRes?.data?.data?.settings?.ordering?.autoCompleteMinutes) {
      const acm = webRes.data.data.settings.ordering.autoCompleteMinutes;
      const col = getPresetAndCustom(acm.collection);
      setColCompPreset(col.preset);
      setColCompCustom(col.custom);

      const del = getPresetAndCustom(acm.delivery);
      setDelCompPreset(del.preset);
      setDelCompCustom(del.custom);

      const tbl = getPresetAndCustom(acm.table);
      setTblCompPreset(tbl.preset);
      setTblCompCustom(tbl.custom);
    }
  }, [webRes]);

  const toggleMutation = useMutation({
    mutationFn: updateOrderToggles,
    onSuccess: () => {
      enqueueSnackbar("Order type toggles updated!", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["store-properties"] });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed", { variant: "error" }),
  });

  const autoReadyMutation = useMutation({
    mutationFn: (minutes) => updateWebsiteSettings({ ordering: { autoReadyMinutes: minutes } }),
    onSuccess: () => {
      enqueueSnackbar("Auto-ready durations updated!", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["website", "settings"] });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed", { variant: "error" }),
  });

  const autoCompleteMutation = useMutation({
    mutationFn: (minutes) => updateWebsiteSettings({ ordering: { autoCompleteMinutes: minutes } }),
    onSuccess: () => {
      enqueueSnackbar("Auto-complete durations updated!", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["website", "settings"] });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed", { variant: "error" }),
  });

  const saveToggles = () => {
    toggleMutation.mutate({ collection: colToggle, delivery: delToggle, table: tblToggle });
  };

  const saveAutoReady = () => {
    autoReadyMutation.mutate({
      collection: Number(colAuto) || 0,
      delivery: Number(delAuto) || 0,
      table: Number(tblAuto) || 0,
    });
  };

  const saveAutoComplete = () => {
    const colVal = colCompPreset === "custom" ? (Number(colCompCustom) || 0) : (Number(colCompPreset) || 0);
    const delVal = delCompPreset === "custom" ? (Number(delCompCustom) || 0) : (Number(delCompPreset) || 0);
    const tblVal = tblCompPreset === "custom" ? (Number(tblCompCustom) || 0) : (Number(tblCompPreset) || 0);

    autoCompleteMutation.mutate({
      collection: colVal,
      delivery: delVal,
      table: tblVal,
    });
  };

  return (
    <div className="space-y-5">
      {/* Module 7 §4: Order Type Toggles */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <div>
          <h4 className="text-[15px] font-extrabold text-[#0F172A]">Order Type Toggles</h4>
          <p className="text-[12px] text-[#94A3B8]">If toggled OFF, order types are removed from POS & website and creation attempts are rejected server-side.</p>
        </div>

        <div className="space-y-3 text-[13px]">
          <div className="flex items-center justify-between p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
            <div>
              <p className="font-bold text-[#0F172A]">Collection Orders</p>
              <p className="text-[11.5px] text-[#64748B]">Takeaway / Pickup orders</p>
            </div>
            <input
              type="checkbox"
              checked={colToggle}
              onChange={(e) => setColToggle(e.target.checked)}
              className="w-5 h-5 accent-[#FD5302]"
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
            <div>
              <p className="font-bold text-[#0F172A]">Delivery Orders</p>
              <p className="text-[11.5px] text-[#64748B]">Home delivery orders</p>
            </div>
            <input
              type="checkbox"
              checked={delToggle}
              onChange={(e) => setDelToggle(e.target.checked)}
              className="w-5 h-5 accent-[#FD5302]"
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
            <div>
              <p className="font-bold text-[#0F172A]">Table Orders</p>
              <p className="text-[11.5px] text-[#64748B]">Dine-in table service</p>
            </div>
            <input
              type="checkbox"
              checked={tblToggle}
              onChange={(e) => setTblToggle(e.target.checked)}
              className="w-5 h-5 accent-[#FD5302]"
            />
          </div>
        </div>

        <div className="pt-1 flex justify-end">
          <button
            onClick={saveToggles}
            disabled={toggleMutation.isPending}
            className="h-[40px] px-5 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502] disabled:opacity-50"
          >
            {toggleMutation.isPending ? "Saving…" : "Save Order Toggles"}
          </button>
        </div>
      </div>

      {/* Module 7 §5: Auto-Ready Settings */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <h4 className="text-[15px] font-extrabold text-[#0F172A]">Auto-Ready Durations</h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[13px]">
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Collection</label>
            <input
              type="number"
              min={0}
              value={colAuto}
              onChange={(e) => setColAuto(e.target.value)}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Delivery</label>
            <input
              type="number"
              min={0}
              value={delAuto}
              onChange={(e) => setDelAuto(e.target.value)}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Table</label>
            <input
              type="number"
              min={0}
              value={tblAuto}
              onChange={(e) => setTblAuto(e.target.value)}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
            />
          </div>
        </div>

        <div className="pt-1 flex justify-end">
          <button
            onClick={saveAutoReady}
            disabled={autoReadyMutation.isPending}
            className="h-[40px] px-5 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502] disabled:opacity-50"
          >
            {autoReadyMutation.isPending ? "Saving…" : "Save Auto-Ready Settings"}
          </button>
        </div>
      </div>

      {/* Auto-Complete Duration Settings */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <h4 className="text-[15px] font-extrabold text-[#0F172A]">Auto-Complete Duration</h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[13px]">
          {/* Collection */}
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8] block mb-1">Collection Orders</label>
            <select
              value={colCompPreset}
              onChange={(e) => setColCompPreset(e.target.value)}
              className="w-full h-[38px] px-3 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] bg-white cursor-pointer"
            >
              <option value="0">Disabled (Manual POS completion)</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="120">2 hours</option>
              <option value="custom">Custom duration</option>
            </select>
            {colCompPreset === "custom" && (
              <input
                type="number"
                min={1}
                placeholder="Duration in minutes"
                value={colCompCustom}
                onChange={(e) => setColCompCustom(e.target.value)}
                className="w-full h-[38px] px-3 mt-2 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
              />
            )}
          </div>

          {/* Delivery */}
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8] block mb-1">Delivery Orders</label>
            <select
              value={delCompPreset}
              onChange={(e) => setDelCompPreset(e.target.value)}
              className="w-full h-[38px] px-3 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] bg-white cursor-pointer"
            >
              <option value="0">Disabled (Manual POS completion)</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="120">2 hours</option>
              <option value="custom">Custom duration</option>
            </select>
            {delCompPreset === "custom" && (
              <input
                type="number"
                min={1}
                placeholder="Duration in minutes"
                value={delCompCustom}
                onChange={(e) => setDelCompCustom(e.target.value)}
                className="w-full h-[38px] px-3 mt-2 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
              />
            )}
          </div>

          {/* Table / Dine-in */}
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8] block mb-1">Table Orders</label>
            <select
              value={tblCompPreset}
              onChange={(e) => setTblCompPreset(e.target.value)}
              className="w-full h-[38px] px-3 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] bg-white cursor-pointer"
            >
              <option value="0">Disabled (Manual POS completion)</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="120">2 hours</option>
              <option value="custom">Custom duration</option>
            </select>
            {tblCompPreset === "custom" && (
              <input
                type="number"
                min={1}
                placeholder="Duration in minutes"
                value={tblCompCustom}
                onChange={(e) => setTblCompCustom(e.target.value)}
                className="w-full h-[38px] px-3 mt-2 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
              />
            )}
          </div>
        </div>

        <div className="pt-1 flex justify-end">
          <button
            onClick={saveAutoComplete}
            disabled={autoCompleteMutation.isPending}
            className="h-[40px] px-5 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502] disabled:opacity-50"
          >
            {autoCompleteMutation.isPending ? "Saving…" : "Save Auto-Complete Settings"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OrderTypesAutoReadyView;
