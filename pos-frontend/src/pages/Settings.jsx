import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import {
  addStaffMember,
  changePin,
  deleteStaffMember,
  getStaffMembers,
  getStoreProperties,
  logout,
  publishSystemCache,
  publishWebsiteCache,
  updateChannelTimings,
  updateHolidays,
  toggleClosedForToday,
  updateOrderToggles,
  updatePosSettings,
  updateStoreProperties,
  verifyPin,
} from "../https";
import { getWebsiteSettings, updateWebsiteSettings } from "../https/storefrontApi";
import { removeUser } from "../redux/slices/userSlice";
import SecurityPinModal from "../components/common/SecurityPinModal";
import { isOwner, checkActionAuthorization } from "../utils/security";
import ActivityLogView from "../components/dashboard/ActivityLogView";

/* ---------- Icons ---------- */
const I = {
  database: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  ),
  printer: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 9V3h12v6" /><rect x="6" y="14" width="12" height="8" rx="1" />
    </svg>
  ),
  store: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" /><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" /><path d="M2 7h20" strokeWidth="2" />
    </svg>
  ),
  utensils: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 2v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V2" /><path d="M12 2v20" /><path d="M6 12h12" />
    </svg>
  ),
  grid: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  users: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  fileText: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  ),
  tag: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41 12 22l-9-9V3h10z" /><circle cx="7" cy="7" r="1.5" />
    </svg>
  ),
  chart: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" />
    </svg>
  ),
  globe: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  headset: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3ZM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3Z" />
    </svg>
  ),
  logout: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  clock: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  calendar: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  lock: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  toggle: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="5" width="22" height="14" rx="7" /><circle cx="16" cy="12" r="4" />
    </svg>
  ),
  chevron: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
  ),
};

/* ---------- Manage Cache ---------- */
const ManageCacheView = () => {
  const sysMutation = useMutation({
    mutationFn: publishSystemCache,
    onSuccess: (res) => enqueueSnackbar(res.data?.message || "System cache updated", { variant: "success" }),
    onError: (err) => enqueueSnackbar(err.response?.data?.message || "Failed to publish system cache", { variant: "error" }),
  });

  const webMutation = useMutation({
    mutationFn: publishWebsiteCache,
    onSuccess: (res) => enqueueSnackbar(res.data?.message || "Website cache updated", { variant: "success" }),
    onError: (err) => enqueueSnackbar(err.response?.data?.message || "Failed to publish website cache", { variant: "error" }),
  });

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[#64748B] leading-relaxed">
        Menu changes do NOT automatically appear in either published environment. Use the triggers below to manually publish your latest categories, prices, and products.
      </p>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] pb-4">
          <div>
            <h4 className="text-[15px] font-extrabold text-[#0F172A]">Update Website Cache</h4>
            <p className="text-[12.5px] text-[#64748B] mt-0.5">
              Publishes menu changes to the public customer website.
            </p>
          </div>
          <button
            onClick={() => webMutation.mutate()}
            disabled={webMutation.isPending}
            className="h-[40px] px-4 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold shrink-0 hover:bg-[#D64502] disabled:opacity-50"
          >
            {webMutation.isPending ? "Publishing…" : "Publish Website"}
          </button>
        </div>

        <div className="flex items-start justify-between gap-4 pt-1">
          <div>
            <h4 className="text-[15px] font-extrabold text-[#0F172A]">Update System Cache</h4>
            <p className="text-[12.5px] text-[#64748B] mt-0.5">
              Publishes menu changes to the POS / System tills.
            </p>
          </div>
          <button
            onClick={() => sysMutation.mutate()}
            disabled={sysMutation.isPending}
            className="h-[40px] px-4 rounded-xl border border-[#FD5302] text-[#C2410C] text-[13px] font-bold shrink-0 hover:bg-[#FFF1E8] disabled:opacity-50"
          >
            {sysMutation.isPending ? "Publishing…" : "Publish System"}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------- Device Configuration ---------- */
const DeviceConfigurationView = () => {
  const qc = useQueryClient();
  const { data: propsRes } = useQuery({ queryKey: ["store-properties"], queryFn: getStoreProperties });
  const posSettings = propsRes?.data?.data?.posSettings || {};

  const [paperWidth, setPaperWidth] = useState("80mm");
  const [autoPrint, setAutoPrint] = useState(posSettings.autoPrintReceipt ?? true);
  const [autoEBill, setAutoEBill] = useState(posSettings.autoEBill ?? false);
  const [customMsg, setCustomMsg] = useState(posSettings.customMessage || "");
  const [webLink, setWebLink] = useState(posSettings.websiteLink || "");

  const posMutation = useMutation({
    mutationFn: updatePosSettings,
    onSuccess: () => {
      enqueueSnackbar("POS & Receipt settings updated!", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["store-properties"] });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to update", { variant: "error" }),
  });

  const save = () => {
    posMutation.mutate({
      autoPrintReceipt: autoPrint,
      autoEBill,
      customMessage: customMsg,
      websiteLink: webLink,
    });
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <h4 className="text-[15px] font-extrabold text-[#0F172A]">Thermal Receipt Printer</h4>
        <div className="space-y-3 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="text-[#334155] font-semibold">Default Paper Size</span>
            <select
              value={paperWidth}
              onChange={(e) => setPaperWidth(e.target.value)}
              className="h-[36px] px-3 rounded-lg border border-[#E2E8F0] font-bold text-[#0F172A]"
            >
              <option value="80mm">80mm (Standard receipt)</option>
              <option value="58mm">58mm (Compact thermal)</option>
            </select>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0]">
            <div>
              <p className="text-[#334155] font-semibold">Auto Receipt Print</p>
              <p className="text-[11.5px] text-[#94A3B8]">Automatically trigger receipt printing on order complete</p>
            </div>
            <input
              type="checkbox"
              checked={autoPrint}
              onChange={(e) => setAutoPrint(e.target.checked)}
              className="w-5 h-5 accent-[#FD5302]"
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0]">
            <div>
              <p className="text-[#334155] font-semibold">Auto E-Bill</p>
              <p className="text-[11.5px] text-[#94A3B8]">Automatically send digital receipt SMS on complete</p>
            </div>
            <input
              type="checkbox"
              checked={autoEBill}
              onChange={(e) => setAutoEBill(e.target.checked)}
              className="w-5 h-5 accent-[#FD5302]"
            />
          </div>
        </div>

        <div className="pt-3 border-t border-[#E2E8F0] space-y-3">
          <h5 className="text-[14px] font-extrabold text-[#0F172A]">Receipt Customization</h5>
          <div>
            <label className="text-[12px] font-bold text-[#94A3B8]">Advertisement / Custom Message</label>
            <input
              value={customMsg}
              onChange={(e) => setCustomMsg(e.target.value)}
              placeholder="e.g. Thank you for dining with us!"
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] text-[13px]"
            />
          </div>
          <div>
            <label className="text-[12px] font-bold text-[#94A3B8]">Website Link on Receipt</label>
            <input
              value={webLink}
              onChange={(e) => setWebLink(e.target.value)}
              placeholder="e.g. https://your-restaurant.com"
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] text-[13px]"
            />
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            onClick={save}
            disabled={posMutation.isPending}
            className="h-[40px] px-5 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502] disabled:opacity-50"
          >
            {posMutation.isPending ? "Saving…" : "Save Receipt Settings"}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------- Module 7 §1 & §2: Store Properties ---------- */
const StorePropertiesView = () => {
  const qc = useQueryClient();
  const user = useSelector((s) => s.user);
  const { data: propsRes, isLoading } = useQuery({ queryKey: ["store-properties"], queryFn: getStoreProperties });
  const storeData = propsRes?.data?.data || {};

  const [pin, setPin] = useState("");
  const [pinVerified, setPinVerified] = useState(false);
  const [showChangePin, setShowChangePin] = useState(false);
  const [currentPinInput, setCurrentPinInput] = useState("");
  const [newPinInput, setNewPinInput] = useState("");

  const [formData, setFormData] = useState({});

  React.useEffect(() => {
    if (storeData.storeName) {
      setFormData({
        storeName: storeData.storeName || "",
        ownerName: storeData.ownerName || "",
        fullAddress: storeData.fullAddress || "",
        secondAddress: storeData.secondAddress || "",
        city: storeData.city || "",
        postalCode: storeData.postalCode || "",
        latitude: storeData.latitude || "",
        longitude: storeData.longitude || "",
        googleMapsLink: storeData.googleMapsLink || "",
        ownerPhone: storeData.ownerPhone || "",
        contactPersonPhone: storeData.contactPersonPhone || "",
        ownerEmail: storeData.ownerEmail || "",
        fssaiNumber: storeData.fssaiNumber || "",
        gstNumber: storeData.gstNumber || "",
        restaurantLogo: storeData.restaurantLogo || "",
      });
    }
  }, [storeData]);

  const verifyMutation = useMutation({
    mutationFn: (p) => verifyPin(p),
    onSuccess: () => {
      setPinVerified(true);
      enqueueSnackbar("PIN Verified! You can now edit store properties.", { variant: "success" });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Invalid PIN", { variant: "error" }),
  });

  const updateMutation = useMutation({
    mutationFn: (data) => updateStoreProperties(data),
    onSuccess: () => {
      enqueueSnackbar("Store properties updated successfully!", { variant: "success" });
      // Invalidate every cache that mirrors these fields so downstream
      // views (POS order panel header, Invoice/receipt print, storefront,
      // Reports header) all refresh in the same tick. Previously we
      // invalidated only the "store-properties" query, so the invoice /
      // print page kept showing the pre-edit name / address / phone.
      qc.invalidateQueries({ queryKey: ["store-properties"] });
      qc.invalidateQueries({ queryKey: ["restaurant", "me"] });
      qc.invalidateQueries({ queryKey: ["website", "settings"] });
      qc.invalidateQueries({ queryKey: ["storefront"] });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to update", { variant: "error" }),
  });

  const changePinMutation = useMutation({
    mutationFn: (data) => changePin(data),
    onSuccess: () => {
      enqueueSnackbar("Protection PIN changed successfully!", { variant: "success" });
      setShowChangePin(false);
      setCurrentPinInput("");
      setNewPinInput("");
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to change PIN", { variant: "error" }),
  });

  const handleSave = () => {
    updateMutation.mutate({ pin, ...formData });
  };

  if (isLoading) return <div className="p-8 text-center text-[#94A3B8]">Loading Store Properties…</div>;

  return (
    <div className="space-y-5">
      {/* Read-Only or Protected Form */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
          <div>
            <h4 className="text-[16px] font-extrabold text-[#0F172A]">Store Properties</h4>
            <p className="text-[12px] text-[#94A3B8]">Editing protected properties requires PIN verification</p>
          </div>
          {!pinVerified ? (
            <div className="flex items-center gap-2">
              <input
                type="password"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter PIN"
                className="h-[36px] w-[140px] px-3 rounded-xl border border-[#E2E8F0] text-[13px] font-bold"
              />
              <button
                onClick={() => verifyMutation.mutate(pin)}
                disabled={verifyMutation.isPending}
                className="h-[36px] px-3.5 rounded-xl bg-[#FD5302] text-white text-[12.5px] font-bold hover:bg-[#D64502]"
              >
                Unlock
              </button>
            </div>
          ) : (
            <span className="px-3 py-1 rounded-full bg-[#DCFCE7] text-[#15803D] text-[12px] font-bold">
              Unlocked for Editing
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[13px]">
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Store Name</label>
            <input
              disabled={!pinVerified}
              value={formData.storeName || ""}
              onChange={(e) => setFormData({ ...formData, storeName: e.target.value })}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] disabled:bg-[#F8FAFC]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Owner Name</label>
            <input
              disabled={!pinVerified}
              value={formData.ownerName || ""}
              onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] disabled:bg-[#F8FAFC]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Full Address</label>
            <input
              disabled={!pinVerified}
              value={formData.fullAddress || ""}
              onChange={(e) => setFormData({ ...formData, fullAddress: e.target.value })}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] disabled:bg-[#F8FAFC]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Second Address (Optional)</label>
            <input
              disabled={!pinVerified}
              value={formData.secondAddress || ""}
              onChange={(e) => setFormData({ ...formData, secondAddress: e.target.value })}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] disabled:bg-[#F8FAFC]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">City</label>
            <input
              disabled={!pinVerified}
              value={formData.city || ""}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] disabled:bg-[#F8FAFC]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">PIN Code</label>
            <input
              disabled={!pinVerified}
              value={formData.postalCode || ""}
              onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] disabled:bg-[#F8FAFC]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Latitude & Longitude</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <input
                disabled={!pinVerified}
                placeholder="Lat"
                value={formData.latitude || ""}
                onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                className="h-[38px] px-3 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] disabled:bg-[#F8FAFC]"
              />
              <input
                disabled={!pinVerified}
                placeholder="Lng"
                value={formData.longitude || ""}
                onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                className="h-[38px] px-3 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] disabled:bg-[#F8FAFC]"
              />
            </div>
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Google Maps Link</label>
            <input
              disabled={!pinVerified}
              value={formData.googleMapsLink || ""}
              onChange={(e) => setFormData({ ...formData, googleMapsLink: e.target.value })}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] disabled:bg-[#F8FAFC]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Owner Phone</label>
            <input
              disabled={!pinVerified}
              value={formData.ownerPhone || ""}
              onChange={(e) => setFormData({ ...formData, ownerPhone: e.target.value })}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] disabled:bg-[#F8FAFC]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Contact Person Phone</label>
            <input
              disabled={!pinVerified}
              value={formData.contactPersonPhone || ""}
              onChange={(e) => setFormData({ ...formData, contactPersonPhone: e.target.value })}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] disabled:bg-[#F8FAFC]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Owner Email</label>
            <input
              disabled={!pinVerified}
              value={formData.ownerEmail || ""}
              onChange={(e) => setFormData({ ...formData, ownerEmail: e.target.value })}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] disabled:bg-[#F8FAFC]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">FSSAI Number</label>
            <input
              disabled={!pinVerified}
              value={formData.fssaiNumber || ""}
              onChange={(e) => setFormData({ ...formData, fssaiNumber: e.target.value })}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] disabled:bg-[#F8FAFC]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">GST Number (Optional)</label>
            <input
              disabled={!pinVerified}
              value={formData.gstNumber || ""}
              onChange={(e) => setFormData({ ...formData, gstNumber: e.target.value })}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] disabled:bg-[#F8FAFC]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Restaurant Logo URL</label>
            <input
              disabled={!pinVerified}
              value={formData.restaurantLogo || ""}
              onChange={(e) => setFormData({ ...formData, restaurantLogo: e.target.value })}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] disabled:bg-[#F8FAFC]"
            />
          </div>
        </div>

        {pinVerified && (
          <div className="pt-3 flex justify-end">
            <button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="h-[42px] px-6 rounded-xl bg-[#FD5302] text-white text-[13.5px] font-bold hover:bg-[#D64502] disabled:opacity-50"
            >
              {updateMutation.isPending ? "Saving Changes…" : "Save Store Properties"}
            </button>
          </div>
        )}
      </div>

      {/* Owner PIN Management */}
      {(user?.role === "Owner" || user?.role === "owner") && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-[15px] font-extrabold text-[#0F172A]">Protection PIN Management</h4>
              <p className="text-[12px] text-[#94A3B8]">Owner can change the security PIN</p>
            </div>
            <button
              onClick={() => setShowChangePin(!showChangePin)}
              className="h-[36px] px-3.5 rounded-xl border border-[#E2E8F0] text-[#334155] text-[12.5px] font-bold hover:bg-[#F8FAFC]"
            >
              {showChangePin ? "Cancel" : "Change PIN"}
            </button>
          </div>

          {showChangePin && (
            <div className="pt-3 border-t border-[#E2E8F0] grid grid-cols-1 md:grid-cols-2 gap-3 text-[13px]">
              <div>
                <label className="text-[11.5px] font-bold text-[#94A3B8]">Current PIN</label>
                <input
                  type="password"
                  maxLength={8}
                  value={currentPinInput}
                  onChange={(e) => setCurrentPinInput(e.target.value)}
                  placeholder="8796"
                  className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold"
                />
              </div>
              <div>
                <label className="text-[11.5px] font-bold text-[#94A3B8]">New PIN (4-8 digits)</label>
                <input
                  type="password"
                  maxLength={8}
                  value={newPinInput}
                  onChange={(e) => setNewPinInput(e.target.value)}
                  placeholder="New PIN"
                  className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold"
                />
              </div>
              <div className="col-span-2 flex justify-end">
                <button
                  onClick={() => changePinMutation.mutate({ currentPin: currentPinInput, newPin: newPinInput })}
                  disabled={changePinMutation.isPending}
                  className="h-[38px] px-5 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502] disabled:opacity-50"
                >
                  {changePinMutation.isPending ? "Updating…" : "Update PIN"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

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

/* ---------- Store Timings UI Redesign & Holidays Calendar ---------- */
const TimingsHolidaysView = () => {
  const qc = useQueryClient();
  const { data: webRes, isLoading } = useQuery({ queryKey: ["website", "settings"], queryFn: getWebsiteSettings });
  const settings = webRes?.data?.data?.settings || {};

  // Active channel tab: "collection", "delivery", or "table"
  const [activeChannel, setActiveChannel] = useState("delivery");

  // Holidays state
  const existingHolidays = settings.holidays || [];
  const [holidays, setHolidays] = useState(existingHolidays);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("Store Closed for Holiday");

  React.useEffect(() => {
    if (settings.holidays) setHolidays(settings.holidays);
  }, [settings.holidays]);

  // Days list Monday to Sunday
  const DAYS = [
    { key: "monday", label: "Monday", dayIndex: 1 },
    { key: "tuesday", label: "Tuesday", dayIndex: 2 },
    { key: "wednesday", label: "Wednesday", dayIndex: 3 },
    { key: "thursday", label: "Thursday", dayIndex: 4 },
    { key: "friday", label: "Friday", dayIndex: 5 },
    { key: "saturday", label: "Saturday", dayIndex: 6 },
    { key: "sunday", label: "Sunday", dayIndex: 0 },
  ];

  // Store timings schedule for current channel
  const channelData = settings.channelHours?.[activeChannel] || {};
  const [sameTimingAllDays, setSameTimingAllDays] = useState(Boolean(channelData.sameTimingAllDays));
  const [weeklySchedule, setWeeklySchedule] = useState({});

  React.useEffect(() => {
    const rawData = settings.channelHours?.[activeChannel] || {};
    setSameTimingAllDays(Boolean(rawData.sameTimingAllDays));
    const map = {};
    DAYS.forEach(({ key, dayIndex }) => {
      const found = (rawData.weekly || []).find((w) => Number(w.day) === dayIndex);
      const openT = found?.openTime || "16:00";
      const closeT = found?.closeTime || "23:50";
      const isOvr = isOvernight(openT, closeT);
      const closeD = found?.closeDay !== undefined && found?.closeDay !== null
        ? Number(found.closeDay)
        : (isOvr ? (dayIndex + 1) % 7 : dayIndex);

      map[key] = {
        isOpen: found ? Boolean(found.isOpen) : true,
        openTime: openT,
        closeDay: closeD,
        closeTime: closeT,
        periods: Array.isArray(found?.periods) ? found.periods : [],
      };
    });
    setWeeklySchedule(map);
  }, [activeChannel, settings]);

  const timingMutation = useMutation({
    mutationFn: updateChannelTimings,
    onSuccess: () => {
      enqueueSnackbar("Store timings updated successfully!", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["website", "settings"] });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to update timings", { variant: "error" }),
  });

  const holidayMutation = useMutation({
    mutationFn: updateHolidays,
    onSuccess: () => {
      enqueueSnackbar("Holidays updated successfully!", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["website", "settings"] });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to update holidays", { variant: "error" }),
  });

  const cftMutation = useMutation({
    mutationFn: toggleClosedForToday,
    onSuccess: (res) => {
      enqueueSnackbar(res.data?.message || "Closed for Today status updated!", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["website", "settings"] });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to update Closed for Today status", { variant: "error" }),
  });

  const isOvernight = (openT, closeT) => {
    if (!openT || !closeT) return false;
    const [oh, om] = openT.split(":").map(Number);
    const [ch, cm] = closeT.split(":").map(Number);
    return ch * 60 + cm < oh * 60 + om;
  };

  const handleToggleDay = (dayKey) => {
    setWeeklySchedule((prev) => ({
      ...prev,
      [dayKey]: {
        ...prev[dayKey],
        isOpen: !prev[dayKey]?.isOpen,
      },
    }));
  };

  const handleTimeChange = (dayKey, field, val, periodIdx = null) => {
    setWeeklySchedule((prev) => {
      const current = prev[dayKey] || { isOpen: true, openTime: "16:00", closeDay: 1, closeTime: "23:50", periods: [] };
      if (periodIdx !== null) {
        const copyPeriods = [...(current.periods || [])];
        copyPeriods[periodIdx] = { ...copyPeriods[periodIdx], [field]: val };
        return { ...prev, [dayKey]: { ...current, periods: copyPeriods } };
      }

      const updated = { ...current, [field]: val };

      // Auto-adjust closeDay if openTime or closeTime is changed and closeDay wasn't manually specified
      if (field === "openTime" || field === "closeTime") {
        const openT = field === "openTime" ? val : current.openTime;
        const closeT = field === "closeTime" ? val : current.closeTime;
        const dayObj = DAYS.find((d) => d.key === dayKey);
        const startDayIdx = dayObj ? dayObj.dayIndex : 0;
        if (isOvernight(openT, closeT)) {
          updated.closeDay = (startDayIdx + 1) % 7;
        } else {
          updated.closeDay = startDayIdx;
        }
      }

      if (sameTimingAllDays) {
        const syncAll = {};
        DAYS.forEach(({ key, dayIndex }) => {
          const itemOpenT = field === "openTime" ? val : (prev[key]?.openTime || "16:00");
          const itemCloseT = field === "closeTime" ? val : (prev[key]?.closeTime || "23:50");
          let itemCloseD = field === "closeDay" ? Number(val) : (prev[key]?.closeDay ?? dayIndex);
          if (field === "openTime" || field === "closeTime") {
            itemCloseD = isOvernight(itemOpenT, itemCloseT) ? (dayIndex + 1) % 7 : dayIndex;
          }
          syncAll[key] = {
            ...prev[key],
            [field]: val,
            closeDay: itemCloseD,
          };
        });
        return syncAll;
      }
      return { ...prev, [dayKey]: updated };
    });
  };

  const handleAddHour = (dayKey) => {
    setWeeklySchedule((prev) => {
      const current = prev[dayKey] || { isOpen: true, openTime: "16:00", closeTime: "23:50", periods: [] };
      const copyPeriods = [...(current.periods || []), { openTime: "21:00", closeTime: "23:50" }];
      return { ...prev, [dayKey]: { ...current, periods: copyPeriods } };
    });
  };

  const handleRemovePeriod = (dayKey, periodIdx) => {
    setWeeklySchedule((prev) => {
      const current = prev[dayKey];
      const copyPeriods = (current.periods || []).filter((_, i) => i !== periodIdx);
      return { ...prev, [dayKey]: { ...current, periods: copyPeriods } };
    });
  };

  const handleSubmitDay = (dayKey) => {
    const weekly = DAYS.map(({ key, dayIndex }) => {
      const dayData = weeklySchedule[key] || { isOpen: true, openTime: "16:00", closeTime: "23:50", periods: [] };
      const openT = dayData.openTime || "16:00";
      const closeT = dayData.closeTime || "23:50";
      const isOvr = isOvernight(openT, closeT);
      const closeD = dayData.closeDay !== undefined && dayData.closeDay !== null
        ? Number(dayData.closeDay)
        : (isOvr ? (dayIndex + 1) % 7 : dayIndex);

      return {
        day: dayIndex,
        isOpen: Boolean(dayData.isOpen),
        openTime: openT,
        closeDay: closeD,
        closeTime: closeT,
        periods: dayData.periods || [],
      };
    });

    timingMutation.mutate({
      channel: activeChannel,
      data: {
        sameTimingAllDays,
        weekly,
      },
    });
  };

  const channelTitle =
    activeChannel === "delivery"
      ? "Shop Delivery Hours"
      : activeChannel === "collection"
      ? "Shop Collection Hours"
      : "Shop Restaurant Hours";

  if (isLoading) return <div className="p-8 text-center text-[#94A3B8]">Loading Store Timings…</div>;

  return (
    <div className="space-y-6 text-[#0F172A]">

      {/* Main Workspace Card */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 shadow-sm space-y-6">

        {/* Top Horizontal Tabs */}
        <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
          <h3 className="text-[20px] font-extrabold tracking-tight text-[#0F172A]">{channelTitle}</h3>

          <div className="flex items-center gap-8 text-[14px]">
            {[
              { key: "collection", label: "Collection Time" },
              { key: "delivery", label: "Delivery Time" },
              { key: "table", label: "Restaurant Time" },
            ].map((tab) => {
              const active = activeChannel === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveChannel(tab.key)}
                  className={`pb-2 transition-all cursor-pointer whitespace-nowrap ${
                    active
                      ? "text-[#1E293B] font-extrabold border-b-2 border-[#FD5302]"
                      : "text-[#64748B] font-semibold hover:text-[#0F172A]"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Same timing for all days option */}
        <div className="flex items-center gap-2 select-none text-[13px] font-bold text-[#475569]">
          <input
            type="checkbox"
            id="sameTiming"
            checked={sameTimingAllDays}
            onChange={(e) => setSameTimingAllDays(e.target.checked)}
            className="w-4 h-4 accent-[#FD5302] cursor-pointer"
          />
          <label htmlFor="sameTiming" className="cursor-pointer">Same timing for all days</label>
        </div>

        {/* Day-by-Day Timings List */}
        <div className="divide-y divide-[#F1F5F9]">
          {/* dayIndex is used below for the end-day dropdown default and the
              overnight badge — destructure it or the whole page throws
              ReferenceError on first render. */}
          {DAYS.map(({ key, label, dayIndex }) => {
            const dayData = weeklySchedule[key] || { isOpen: true, openTime: "16:00", closeTime: "23:50", periods: [] };
            const isOpen = dayData.isOpen;
            const overnight = isOpen && isOvernight(dayData.openTime, dayData.closeTime);

            return (
              <div key={key} className="py-4 space-y-3">
                {/* flex-wrap: the row is a fixed ~975px of controls, so on a
                    narrow window the badge and buttons drop to a second line
                    instead of overflowing the card. */}
                <div className="flex items-center gap-4 text-[13.5px] flex-wrap">
                  {/* ON/OFF Switch */}
                  <div className="flex items-center gap-2.5 w-[90px] shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleDay(key)}
                      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
                        isOpen ? "bg-[#22C55E]" : "bg-[#CBD5E1]"
                      }`}
                    >
                      <span
                        className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                          isOpen ? "right-1" : "left-1"
                        }`}
                      />
                    </button>
                    <span className={`font-bold text-[13px] ${isOpen ? "text-[#16A34A]" : "text-[#94A3B8]"}`}>
                      {isOpen ? "Open" : "Closed"}
                    </span>
                  </div>

                  {/* Day Name */}
                  <span className="font-extrabold text-[14.5px] text-[#334155] w-[110px] shrink-0">
                    {label}
                  </span>

                  {/* Primary Operating Time Inputs.
                      Fixed widths, not flex-1: letting this block stretch pushed
                      the action buttons to the far edge of the card and opened a
                      chasm across the middle of every row. */}
                  {isOpen ? (
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Opening / Start Time Input */}
                      <input
                        type="time"
                        value={dayData.openTime}
                        onChange={(e) => handleTimeChange(key, "openTime", e.target.value)}
                        className="w-[125px] h-[38px] px-3 rounded-lg border border-[#E2E8F0] font-semibold text-[13.5px] text-[#334155] bg-white focus:border-[#FD5302]"
                      />

                      {/* Connector Arrow */}
                      <span className="text-[#C2410C] font-extrabold text-sm px-1">→</span>

                      {/* End Day Selector Dropdown */}
                      <div className="flex items-center gap-1.5">
                        <select
                          value={dayData.closeDay !== undefined && dayData.closeDay !== null ? dayData.closeDay : (overnight ? (dayIndex + 1) % 7 : dayIndex)}
                          onChange={(e) => handleTimeChange(key, "closeDay", Number(e.target.value))}
                          className="w-[145px] h-[38px] px-2.5 rounded-lg border border-[#E2E8F0] font-semibold text-[13px] text-[#334155] bg-white focus:border-[#FD5302] cursor-pointer"
                          title="Select End Day"
                        >
                          {DAYS.map((d) => (
                            <option key={d.dayIndex} value={d.dayIndex}>
                              {d.label}
                            </option>
                          ))}
                        </select>

                        {/* Closing / End Time Input */}
                        <input
                          type="time"
                          value={dayData.closeTime}
                          onChange={(e) => handleTimeChange(key, "closeTime", e.target.value)}
                          className="w-[125px] h-[38px] px-3 rounded-lg border border-[#E2E8F0] font-semibold text-[13.5px] text-[#334155] bg-white focus:border-[#FD5302]"
                        />
                      </div>

                    </div>
                  ) : (
                    // 125 + 8 + 22 (arrow) + 8 + (145 + 6 + 125) — the width of the time
                    // block above, so the buttons sit in the same place either way.
                    <div className="w-[439px] shrink-0 text-[13px] font-bold text-[#94A3B8] italic">
                      Closed all day
                    </div>
                  )}

                  {/* Overnight / Next-Day Indicator Badge.
                      Reserved slot rather than a conditional element, so one
                      overnight day doesn't shove its own buttons out of line
                      with every other row. */}
                  <div className="w-[104px] shrink-0">
                    {isOpen && (Number(dayData.closeDay) !== dayIndex || overnight) && (
                      <span className="px-2.5 py-1 rounded-md bg-[#FFF1E8] text-[#C2410C] text-[11px] font-extrabold flex items-center gap-1 w-fit">
                        <span>🌙</span> Overnight
                      </span>
                    )}
                  </div>

                  {/* Actions: Add Hour & Submit. Right-aligned inside a fixed
                      slot so Submit keeps its column on closed days, where
                      Add Hour isn't rendered. */}
                  <div className="w-[168px] shrink-0 flex items-center justify-end gap-2">
                    {isOpen && (
                      <button
                        type="button"
                        onClick={() => handleAddHour(key)}
                        className="h-[34px] px-3.5 rounded-lg bg-[#E0F2FE] text-[#0284C7] font-bold text-[12px] hover:bg-[#BAE6FD] transition-colors"
                      >
                        Add Hour
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSubmitDay(key)}
                      disabled={timingMutation.isPending}
                      className="h-[34px] px-4 rounded-lg bg-[#DCFCE7] text-[#15803D] font-bold text-[12px] hover:bg-[#BBF7D0] transition-colors disabled:opacity-50"
                    >
                      {timingMutation.isPending ? "Saving…" : "Submit"}
                    </button>
                  </div>
                </div>

                {/* Additional Operating Periods */}
                {isOpen && (dayData.periods || []).map((period, pIdx) => (
                  <div key={pIdx} className="pl-[204px] flex items-center gap-3 text-[13px]">
                    <span className="text-[11px] font-extrabold text-[#94A3B8] uppercase">Slot {pIdx + 2}:</span>
                    <input
                      type="time"
                      value={period.openTime}
                      onChange={(e) => handleTimeChange(key, "openTime", e.target.value, pIdx)}
                      className="h-[34px] px-2.5 rounded-lg border border-[#E2E8F0] font-semibold text-[12.5px]"
                    />

                    <span className="text-[#94A3B8] font-bold px-1">—</span>

                    <input
                      type="time"
                      value={period.closeTime}
                      onChange={(e) => handleTimeChange(key, "closeTime", e.target.value, pIdx)}
                      className="h-[34px] px-2.5 rounded-lg border border-[#E2E8F0] font-semibold text-[12.5px]"
                    />

                    <button
                      type="button"
                      onClick={() => handleRemovePeriod(key, pIdx)}
                      className="text-[#DC2626] font-bold text-[11.5px] hover:underline ml-2"
                    >
                      Remove Slot
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Closed for Today 1-Day Override Card */}
      <div className={`border rounded-2xl p-5 transition-all ${
        settings.closedForToday?.enabled
          ? "bg-[#FEF2F2] border-[#FCA5A5]"
          : "bg-white border-[#E2E8F0]"
      }`}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="space-y-1 max-w-[640px]">
            <div className="flex items-center gap-2.5">
              <h4 className="text-[15px] font-extrabold text-[#0F172A]">Closed for Today</h4>
              {settings.closedForToday?.enabled ? (
                <span className="px-2.5 py-0.5 rounded-full bg-[#DC2626] text-white text-[11px] font-extrabold uppercase tracking-wide animate-pulse">
                  Active (Closed Today)
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full bg-[#F1F5F9] text-[#64748B] text-[11px] font-bold">
                  Normal Schedule Active
                </span>
              )}
            </div>
            <p className="text-[12.5px] text-[#475569]">
              Temporarily close takeaway and online ordering for the entire current business day (including overnight shift). Regular schedule will automatically resume tomorrow without altering any configured hours.
            </p>
            {settings.closedForToday?.enabled && (
              <p className="text-[12px] font-bold text-[#DC2626] pt-1">
                🚫 Ordering is currently blocked for today ({settings.closedForToday?.date}). Will automatically re-open on tomorrow's scheduled time.
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                const nowState = Boolean(settings.closedForToday?.enabled);
                cftMutation.mutate({ enabled: !nowState });
              }}
              disabled={cftMutation.isPending}
              className={`h-[42px] px-5 rounded-xl text-[13.5px] font-extrabold transition-all flex items-center gap-2 shadow-xs ${
                settings.closedForToday?.enabled
                  ? "bg-[#DC2626] text-white hover:bg-[#B91C1C]"
                  : "bg-[#0F172A] text-white hover:bg-[#1E293B]"
              } disabled:opacity-50`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${settings.closedForToday?.enabled ? "bg-white animate-ping" : "bg-emerald-400"}`} />
              {settings.closedForToday?.enabled ? "Turn Off 'Closed for Today'" : "Enable 'Closed for Today'"}
            </button>
          </div>
        </div>
      </div>

      {/* Module 7 §7: Holidays Calendar */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <div>
          <h4 className="text-[15px] font-extrabold text-[#0F172A]">Holidays Calendar</h4>
          <p className="text-[12px] text-[#94A3B8]">During a holiday, website displays "Store is Closed" and online ordering is blocked server-side.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[13px]">
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Reason / Message</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Annual Staff Day"
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => {
              if (!startDate || !endDate) {
                enqueueSnackbar("Start date and end date are required.", { variant: "warning" });
                return;
              }
              const updated = [...holidays, { startDate, endDate, reason }];
              setHolidays(updated);
              holidayMutation.mutate({ holidays: updated });
              setStartDate("");
              setEndDate("");
              setReason("Store Closed for Holiday");
            }}
            disabled={holidayMutation.isPending}
            className="h-[38px] px-4 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502] disabled:opacity-50"
          >
            Add Holiday
          </button>
        </div>

        <div className="pt-2 border-t border-[#E2E8F0]">
          <h5 className="text-[13px] font-extrabold text-[#0F172A] mb-2">Configured Holidays ({holidays.length})</h5>
          {holidays.length === 0 ? (
            <p className="text-[12.5px] text-[#94A3B8]">No holidays scheduled.</p>
          ) : (
            <div className="space-y-2">
              {holidays.map((h, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[13px]">
                  <div>
                    <p className="font-bold text-[#0F172A]">{h.reason || "Holiday"}</p>
                    <p className="text-[11.5px] text-[#64748B]">
                      {new Date(h.startDate).toLocaleDateString("en-GB")} → {new Date(h.endDate).toLocaleDateString("en-GB")}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const updated = holidays.filter((_, idx) => idx !== i);
                      setHolidays(updated);
                      holidayMutation.mutate({ holidays: updated });
                    }}
                    className="h-8 px-3 rounded-lg border border-[#FECACA] text-[#DC2626] font-bold text-[12px] hover:bg-[#FEF2F2]"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ---------- Module 7 §8 & §9: Manage Staff ---------- */
const ManageStaffView = () => {
  const qc = useQueryClient();
  const user = useSelector((s) => s.user);
  const isOwner = user?.role === "Owner" || user?.role === "owner";

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const { data: staffRes, isLoading } = useQuery({ queryKey: ["staff-members"], queryFn: getStaffMembers, enabled: isOwner });
  const staffList = staffRes?.data?.data || [];

  const addMutation = useMutation({
    mutationFn: addStaffMember,
    onSuccess: () => {
      enqueueSnackbar("Staff member added successfully!", { variant: "success" });
      setName("");
      setPhone("");
      qc.invalidateQueries({ queryKey: ["staff-members"] });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to add staff", { variant: "error" }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteStaffMember,
    onSuccess: () => {
      enqueueSnackbar("Staff member deleted!", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["staff-members"] });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to delete", { variant: "error" }),
  });

  if (!isOwner) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 text-[13px] text-[#DC2626] font-bold">
        🔒 Action Restricted: Only the Store Owner can manage staff members and permissions. Staff PIN verification is not sufficient for this operation.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Add Staff */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <div>
          <h4 className="text-[15px] font-extrabold text-[#0F172A]">Add Staff Member</h4>
          <p className="text-[12px] text-[#94A3B8]">Staff members sign in with the Store ID and their registered phone number.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[13px]">
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Staff Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Staff Phone Number (10 digits)</label>
            <input
              type="tel"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => addMutation.mutate({ name, phone })}
            disabled={addMutation.isPending}
            className="h-[40px] px-5 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502] disabled:opacity-50"
          >
            {addMutation.isPending ? "Adding…" : "Add Staff Member"}
          </button>
        </div>
      </div>

      {/* Staff List */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-3">
        <h4 className="text-[15px] font-extrabold text-[#0F172A]">Staff Members ({staffList.length})</h4>
        {isLoading ? (
          <p className="text-[13px] text-[#94A3B8]">Loading staff list…</p>
        ) : staffList.length === 0 ? (
          <p className="text-[13px] text-[#94A3B8]">No staff members registered yet.</p>
        ) : (
          <div className="space-y-2">
            {staffList.map((s) => (
              <div key={s._id} className="flex items-center justify-between p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[13px]">
                <div>
                  <p className="font-extrabold text-[#0F172A]">{s.name}</p>
                  <p className="text-[11.5px] text-[#64748B]">Phone: {s.phone} · Role: {s.role}</p>
                </div>
                <button
                  onClick={() => deleteMutation.mutate(s._id)}
                  disabled={deleteMutation.isPending}
                  className="h-8 px-3 rounded-lg border border-[#FECACA] text-[#DC2626] font-bold text-[12px] hover:bg-[#FEF2F2]"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ---------- Module 8: Rules, Charges & Promotions ---------- */
const RulesChargesView = () => {
  const qc = useQueryClient();
  const { data: webRes, isLoading } = useQuery({ queryKey: ["website", "settings"], queryFn: getWebsiteSettings });
  const settings = webRes?.data?.data?.settings || {};
  const ordering = settings.ordering || {};

  const [gstApply, setGstApply] = useState(ordering.gstApplyTo || "both");
  const [packApply, setPackApply] = useState(ordering.packingApplyTo || "both");
  const [maxDist, setMaxDist] = useState(ordering.deliverySlabsConfig?.maxDistanceKm ?? 7);
  const [slabs, setSlabs] = useState(ordering.deliverySlabsConfig?.slabs || []);
  const [sMin, setSMin] = useState(""); const [sMax, setSMax] = useState(""); const [sFee, setSFee] = useState("");
  const [coupons, setCoupons] = useState(settings.couponsConfig || []);
  const [cCode, setCCode] = useState(""); const [cType, setCType] = useState("percent"); const [cVal, setCVal] = useState(""); const [cMin, setCMin] = useState("");
  const [freeRules, setFreeRules] = useState(settings.freeItemConfig || []);
  const [fName, setFName] = useState(""); const [fMin, setFMin] = useState("");

  const mut = useMutation({
    mutationFn: (d) => updateWebsiteSettings(d),
    onSuccess: () => { enqueueSnackbar("Saved!", { variant: "success" }); qc.invalidateQueries({ queryKey: ["website", "settings"] }); },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed", { variant: "error" }),
  });

  if (isLoading) return <div className="p-8 text-center text-[#94A3B8]">Loading…</div>;

  return (
    <div className="space-y-6">
      {/* §3 GST & Packing */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <h4 className="text-[15px] font-extrabold text-[#0F172A]">GST & Packing Applicability</h4>
        <div className="grid grid-cols-2 gap-4 text-[13px]">
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">GST applies to</label>
            <select value={gstApply} onChange={(e)=>setGstApply(e.target.value)} className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold">
              <option value="both">Both</option><option value="website">Website</option><option value="system">System</option>
            </select>
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Packing applies to</label>
            <select value={packApply} onChange={(e)=>setPackApply(e.target.value)} className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold">
              <option value="both">Both</option><option value="website">Website</option><option value="system">System</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end">
          <button onClick={()=>mut.mutate({ordering:{gstApplyTo:gstApply,packingApplyTo:packApply}})} disabled={mut.isPending} className="h-[38px] px-4 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold">Save</button>
        </div>
      </div>

      {/* §2 Delivery Distance Slabs */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <h4 className="text-[15px] font-extrabold text-[#0F172A]">Delivery Distance Slabs</h4>
        <p className="text-[12px] text-[#94A3B8]">Distance calculated server-side. Orders beyond max distance are rejected.</p>
        <div className="grid grid-cols-4 gap-3 text-[13px] items-end">
          <div><label className="text-[11px] font-bold text-[#94A3B8]">Max Distance (km)</label><input type="number" min={0} value={maxDist} onChange={(e)=>setMaxDist(e.target.value)} className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"/></div>
          <div><label className="text-[11px] font-bold text-[#94A3B8]">Min km</label><input type="number" value={sMin} onChange={(e)=>setSMin(e.target.value)} placeholder="0" className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"/></div>
          <div><label className="text-[11px] font-bold text-[#94A3B8]">Max km</label><input type="number" value={sMax} onChange={(e)=>setSMax(e.target.value)} placeholder="3" className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"/></div>
          <div className="flex gap-2"><div className="flex-1"><label className="text-[11px] font-bold text-[#94A3B8]">Fee ₹</label><input type="number" value={sFee} onChange={(e)=>setSFee(e.target.value)} placeholder="30" className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"/></div>
            <button onClick={()=>{if(!sMin||!sMax||!sFee){enqueueSnackbar("Fill all slab fields",{variant:"warning"});return;}const u=[...slabs,{minKm:+sMin,maxKm:+sMax,fee:+sFee}];setSlabs(u);setSMin("");setSMax("");setSFee("");mut.mutate({ordering:{deliverySlabsConfig:{maxDistanceKm:+maxDist||7,slabs:u}}});}} className="mt-5 h-[36px] px-3 rounded-xl bg-[#FD5302] text-white text-[12px] font-bold shrink-0">Add</button>
          </div>
        </div>
        {slabs.length>0&&<div className="pt-2 border-t border-[#E2E8F0] space-y-2 text-[13px]">{slabs.map((s,i)=><div key={i} className="flex justify-between p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]"><span className="font-bold">{s.minKm}–{s.maxKm} km → ₹{s.fee}</span><button onClick={()=>{const u=slabs.filter((_,j)=>j!==i);setSlabs(u);mut.mutate({ordering:{deliverySlabsConfig:{maxDistanceKm:+maxDist||7,slabs:u}}});}} className="text-[#DC2626] font-bold text-[12px]">Remove</button></div>)}</div>}
      </div>

      {/* §5 Coupons */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <h4 className="text-[15px] font-extrabold text-[#0F172A]">Website Coupons</h4>
        <div className="grid grid-cols-4 gap-3 text-[13px] items-end">
          <div><label className="text-[11px] font-bold text-[#94A3B8]">Code</label><input value={cCode} onChange={(e)=>setCCode(e.target.value)} placeholder="WELCOME10" className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold uppercase"/></div>
          <div><label className="text-[11px] font-bold text-[#94A3B8]">Type</label><select value={cType} onChange={(e)=>setCType(e.target.value)} className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"><option value="percent">%</option><option value="fixed">₹</option></select></div>
          <div><label className="text-[11px] font-bold text-[#94A3B8]">Value</label><input type="number" value={cVal} onChange={(e)=>setCVal(e.target.value)} className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"/></div>
          <div className="flex gap-2"><div className="flex-1"><label className="text-[11px] font-bold text-[#94A3B8]">Min Order ₹</label><input type="number" value={cMin} onChange={(e)=>setCMin(e.target.value)} className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"/></div>
            <button onClick={()=>{if(!cCode||!cVal){enqueueSnackbar("Code & value required",{variant:"warning"});return;}const u=[...coupons,{code:cCode.toUpperCase().trim(),type:cType,value:+cVal,minOrderAmount:+cMin||0,isActive:true}];setCoupons(u);setCCode("");setCVal("");setCMin("");mut.mutate({couponsConfig:u});}} className="mt-5 h-[36px] px-3 rounded-xl bg-[#FD5302] text-white text-[12px] font-bold shrink-0">Add</button>
          </div>
        </div>
        {coupons.length>0&&<div className="pt-2 border-t border-[#E2E8F0] space-y-2 text-[13px]">{coupons.map((c,i)=><div key={i} className="flex justify-between p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]"><span className="font-bold">{c.code} → {c.type==="percent"?`${c.value}%`:`₹${c.value}`} (min ₹{c.minOrderAmount||0})</span><button onClick={()=>{const u=coupons.filter((_,j)=>j!==i);setCoupons(u);mut.mutate({couponsConfig:u});}} className="text-[#DC2626] font-bold text-[12px]">Remove</button></div>)}</div>}
      </div>

      {/* §6 Free Item */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <h4 className="text-[15px] font-extrabold text-[#0F172A]">Free Item Promotions</h4>
        <p className="text-[12px] text-[#94A3B8]">Server-side only. Price forced to ₹0. Shown on receipt.</p>
        <div className="grid grid-cols-3 gap-3 text-[13px] items-end">
          <div><label className="text-[11px] font-bold text-[#94A3B8]">Item Name</label><input value={fName} onChange={(e)=>setFName(e.target.value)} placeholder="Free Gulab Jamun" className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"/></div>
          <div><label className="text-[11px] font-bold text-[#94A3B8]">Min Order ₹</label><input type="number" value={fMin} onChange={(e)=>setFMin(e.target.value)} placeholder="500" className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold"/></div>
          <button onClick={()=>{if(!fName){enqueueSnackbar("Item name required",{variant:"warning"});return;}const u=[...freeRules,{itemName:fName.trim(),minOrderAmount:+fMin||0,applyTo:"both",isActive:true}];setFreeRules(u);setFName("");setFMin("");mut.mutate({freeItemConfig:u});}} className="h-[36px] px-4 rounded-xl bg-[#FD5302] text-white text-[12px] font-bold">Add Rule</button>
        </div>
        {freeRules.length>0&&<div className="pt-2 border-t border-[#E2E8F0] space-y-2 text-[13px]">{freeRules.map((r,i)=><div key={i} className="flex justify-between p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]"><span className="font-bold">{r.itemName} (min ₹{r.minOrderAmount||0})</span><button onClick={()=>{const u=freeRules.filter((_,j)=>j!==i);setFreeRules(u);mut.mutate({freeItemConfig:u});}} className="text-[#DC2626] font-bold text-[12px]">Remove</button></div>)}</div>}
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
          <li>Delivery Fee (distance slabs / max distance)</li>
          <li>Total = max(0, Subtotal − Discount + Packing + Delivery + Tax)</li>
        </ol>
      </div>
    </div>
  );
};

/* ---------- Main Settings layout (Module 6 & Module 7) ---------- */


const MENU_ITEMS = [
  { id: "cache", title: "1. Manage Cache", desc: "Publish menu changes to Website or System cache.", Icon: I.database, mode: "view" },
  { id: "device", title: "2. Device Configuration", desc: "Printer paper sizes, auto-print & e-bill settings.", Icon: I.printer, mode: "view" },
  { id: "properties", title: "3. Store Properties", desc: "14 store details & protection PIN.", Icon: I.store, mode: "view" },
  { id: "menu", title: "4. Manage Menu", desc: "Categories, dishes, variants and add-ons.", Icon: I.utensils, path: "/manage-menu" },
  { id: "table", title: "5. Manage Table", desc: "Table layouts and session status.", Icon: I.grid, path: "/tables" },
  { id: "staff", title: "6. Manage Staff", desc: "Add/delete staff and PIN privileges.", Icon: I.users, mode: "view" },
  { id: "toggles", title: "7. Order Toggles & Auto-Ready", desc: "Channel ON/OFF & auto-ready durations.", Icon: I.toggle, mode: "view" },
  { id: "timings", title: "8. Timings & Holidays", desc: "Channel schedules & holiday calendar.", Icon: I.calendar, mode: "view" },
  { id: "rules", title: "9. Rules, Charges & Promotions", desc: "Min orders, delivery slabs, GST, coupons, free items.", Icon: I.fileText, mode: "view" },
  { id: "reports", title: "10. Reports", desc: "Sales, revenue and order breakdowns.", Icon: I.chart, path: "/reports" },

  { id: "website", title: "10. Manage Website", desc: "Storefront theme, branding and ordering options.", Icon: I.globe, path: "/website" },
  { id: "activity", title: "11. Activity Log & Audit Trail", desc: "View append-only audit log of all store and security changes.", Icon: I.fileText, mode: "view" },
  { id: "support", title: "12. Help & Support", desc: "Get help or report an issue.", Icon: I.headset, path: "/support" },
  { id: "logout", title: "13. Logout", desc: "Securely sign out of the POS system.", Icon: I.logout, action: "logout" },
];

const Settings = () => {
  useEffect(() => {
    document.title = "KnotKitchen | Settings";
  }, []);

  const [activeSubView, setActiveSubView] = useState(null);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSuccess: () => {
      dispatch(removeUser());
      navigate("/auth");
    },
  });

  const handleClick = (item) => {
    if (item.action === "logout") {
      logoutMutation.mutate();
      return;
    }
    if (item.path) {
      navigate(item.path);
      return;
    }
    if (item.mode === "view") {
      setActiveSubView(item.id);
    }
  };

  const activeMeta = MENU_ITEMS.find((m) => m.id === activeSubView);

  return (
    <div className="h-full w-full overflow-y-auto bg-[#F8FAFC]">
      <div className="max-w-[1100px] mx-auto px-7 py-6">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          {activeSubView && (
            <button
              onClick={() => setActiveSubView(null)}
              className="h-[36px] px-3 rounded-xl border border-[#E2E8F0] bg-white text-[#334155] text-[13px] font-bold hover:border-[#CBD5E1]"
            >
              ← Back
            </button>
          )}
          <div>
            <h1 className="text-[28px] font-extrabold text-[#0F172A] tracking-tight">
              {activeMeta ? activeMeta.title : "Settings"}
            </h1>
            <p className="text-[13.5px] text-[#94A3B8] mt-0.5">
              {activeMeta ? activeMeta.desc : "Configure store properties, device printers, order toggles, staff and cache."}
            </p>
          </div>
        </div>

        {/* Active sub-view or item list */}
        {activeSubView === "cache" ? (
          <ManageCacheView />
        ) : activeSubView === "device" ? (
          <DeviceConfigurationView />
        ) : activeSubView === "properties" ? (
          <StorePropertiesView />
        ) : activeSubView === "toggles" ? (
          <OrderTypesAutoReadyView />
        ) : activeSubView === "timings" ? (
          <TimingsHolidaysView />
        ) : activeSubView === "staff" ? (
          <ManageStaffView />
        ) : activeSubView === "rules" ? (
          <RulesChargesView />
        ) : activeSubView === "activity" ? (
          <ActivityLogView />
        ) : (

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {MENU_ITEMS.map((item) => {
              const Icon = item.Icon;
              const isLogout = item.action === "logout";
              return (
                <button
                  key={item.id}
                  onClick={() => handleClick(item)}
                  className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center gap-4 bg-white ${
                    isLogout
                      ? "border-[#FECACA] hover:border-[#EF4444] hover:bg-[#FEF2F2]"
                      : "border-[#E2E8F0] hover:border-[#FD5302] hover:shadow-md"
                  }`}
                >
                  <span
                    className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                      isLogout ? "bg-[#FEF2F2] text-[#DC2626]" : "bg-[#FFF6F0] text-[#C2410C]"
                    }`}
                  >
                    <Icon />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-[15px] font-extrabold ${isLogout ? "text-[#DC2626]" : "text-[#0F172A]"}`}>
                      {item.title}
                    </p>
                    <p className="text-[12px] text-[#94A3B8] truncate mt-0.5">{item.desc}</p>
                  </div>
                  <span className="text-[#94A3B8] shrink-0"><I.chevron /></span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;
