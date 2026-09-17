import React, { useState } from "react";
import { useSelector } from "react-redux";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { changePin, getStoreProperties, updateStoreProperties, verifyPin } from "../../https";
import { uploadMedia } from "../../https/storefrontApi";

/**
 * The store's logo: uploaded here, shown everywhere -- the POS header, the
 * invoice, printed receipts, the table QR page and the website. Saved with
 * the rest of Store Properties.
 */
const StoreLogoField = ({ value, disabled, onChange }) => {
  const fileRef = React.useRef(null);
  const [uploading, setUploading] = useState(false);
  const [broken, setBroken] = useState(false);

  const onFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadMedia(file, { folder: "logo", altText: "Store logo" });
      const url = res.data?.data?.url;
      if (!url) throw new Error("Upload failed.");
      setBroken(false);
      onChange(url);
      enqueueSnackbar("Logo uploaded. Press Save Store Properties to apply it.", { variant: "info" });
    } catch (err) {
      enqueueSnackbar(err?.response?.data?.message || err.message || "Upload failed.", { variant: "error" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
      <div className="h-20 w-20 shrink-0 rounded-xl border border-[#E2E8F0] bg-white flex items-center justify-center overflow-hidden">
        {value && !broken ? (
          <img src={value} alt="Store logo" className="h-full w-full object-contain p-1" onError={() => setBroken(true)} />
        ) : (
          <span className="text-[11px] font-bold text-[#94A3B8]">No logo</span>
        )}
      </div>
      <div className="min-w-[220px] flex-1">
        <p className="text-[13.5px] font-extrabold text-[#0F172A]">Store Logo</p>
        <p className="text-[11.5px] text-[#64748B]">
          Shown on the POS, invoices, printed receipts, the table QR page and your website. PNG, JPG or WebP; a square image works best.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => fileRef.current?.click()}
            className="h-[34px] px-3.5 rounded-xl bg-[#0F172A] text-white text-[12.5px] font-bold hover:bg-[#1E293B] disabled:opacity-40"
          >
            {uploading ? "Uploading…" : value ? "Change logo" : "Upload logo"}
          </button>
          {value ? (
            <button
              type="button"
              disabled={disabled || uploading}
              onClick={() => onChange("")}
              className="h-[34px] px-3 rounded-xl border border-[#E2E8F0] text-[12.5px] font-bold text-[#DC2626] hover:bg-white disabled:opacity-40"
            >
              Remove
            </button>
          ) : null}
          {disabled ? <span className="text-[11.5px] text-[#94A3B8]">Unlock with your PIN to change it.</span> : null}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => onFile(e.target.files?.[0])}
        />
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] pb-3">
          <div className="min-w-0">
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
                inputMode="numeric"
                className="h-[40px] w-[140px] px-3 rounded-xl border border-[#E2E8F0] text-[13px] font-bold"
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

        <StoreLogoField
          value={formData.restaurantLogo || ""}
          disabled={!pinVerified}
          onChange={(url) => setFormData((f) => ({ ...f, restaurantLogo: url }))}
        />

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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
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
                  placeholder="Current PIN"
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

export default StorePropertiesView;
