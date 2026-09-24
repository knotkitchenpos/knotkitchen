import React, { useEffect, useState } from "react";
import { enqueueSnackbar } from "notistack";
import { IconX } from "./icons";
import { uploadMediaAsset } from "../../../https";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const TARGET_BYTES = 200 * 1024;

/**
 * Shrinks a photo to WebP of about 200 KB (longest side 1600px at most) in the
 * browser, so a 12 MB phone photo or a BMP still uploads, and fast. The server
 * re-encodes item photos to WebP of that size anyway
 * (pos-backend/services/imageCompress.js), so when this browser cannot decode
 * the file or write WebP, the original goes up as it is.
 */
const shrinkToWebp = async (file) => {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let side = 1600;
    let blob = null;
    for (let round = 0; round < 5; round += 1) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.72, 0.62, 0.52]) {
        blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
        if (!blob || blob.type !== "image/webp") return file;
        if (blob.size <= TARGET_BYTES) break;
      }
      if (blob.size <= TARGET_BYTES) break;
      side = Math.round(side * 0.75);
    }
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.webp`, { type: "image/webp" });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
};

/**
 * The product slide-over: name, prices per channel, groups, schedule, image.
 * Owns its form; the page says what to load (`editing`, or null for a new
 * product) and which mutation to run.
 */
const ProductDrawer = ({
  open,
  editing,
  activeCategory,
  activeSubcategory,
  groupsList,
  allGroupsMap,
  addDishMut,
  updateDishMut,
  onClose,
}) => {
  const [prodAvailable, setProdAvailable] = useState(true);
  const [prodScheduleEnabled, setProdScheduleEnabled] = useState(false);
  const [prodStartTime, setProdStartTime] = useState("09:00");
  const [prodEndTime, setProdEndTime] = useState("23:00");
  const [prodDaysOfWeek, setProdDaysOfWeek] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [prodName, setProdName] = useState("");
  const [prodDesc, setProdDesc] = useState("");
  const [prodPrice, setProdPrice] = useState("100");
  const [prodSamePrice, setProdSamePrice] = useState(true);
  const [channelPrices, setChannelPrices] = useState({
    posCollection: "100",
    posDelivery: "100",
    posTable: "100",
    websiteCollection: "100",
    websiteDelivery: "100",
    websiteTable: "100",
  });
  const [prodVeg, setProdVeg] = useState(true);
  const [prodDisplay, setProdDisplay] = useState("both");
  const [prodOffOnPos, setProdOffOnPos] = useState(false);
  const [prodOffOnWebsite, setProdOffOnWebsite] = useState(false);
  const [prodImageUrl, setProdImageUrl] = useState("");
  const [uploadingImg, setUploadingImg] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [prodAssignedGroupNames, setProdAssignedGroupNames] = useState([]);
  const [dispatchAll, setDispatchAll] = useState(true);
  const [dispatchCol, setDispatchCol] = useState(true);
  const [dispatchDel, setDispatchDel] = useState(true);
  const [dispatchTbl, setDispatchTbl] = useState(true);

  const showCreateProduct = open;
  const editingProduct = editing;

  // One path for a picked, pasted or dropped photo.
  const uploadImage = async (picked) => {
    if (!picked || uploadingImg) return;
    if (!picked.type.startsWith("image/")) {
      enqueueSnackbar("That is not an image.", { variant: "error" });
      return;
    }
    setUploadingImg(true);
    try {
      const file = await shrinkToWebp(picked);
      if (file.size > MAX_UPLOAD_BYTES) {
        enqueueSnackbar("This image is too big to convert here. Use one under 5 MB.", { variant: "error" });
        return;
      }
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folder", "products");
      const res = await uploadMediaAsset(formData);
      const uploadedUrl = res.data?.data?.url;
      if (uploadedUrl) {
        setProdImageUrl(uploadedUrl);
        enqueueSnackbar("Product image uploaded successfully!", { variant: "success" });
      }
    } catch (err) {
      const url = prompt("Upload failed. Enter image URL instead:", prodImageUrl);
      if (url) setProdImageUrl(url.trim());
    } finally {
      setUploadingImg(false);
    }
  };

  // Ctrl+V anywhere in the open drawer attaches a copied image. A text paste
  // into a field is left alone.
  useEffect(() => {
    if (!open) return undefined;
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === "file" && i.type.startsWith("image/"));
      if (!item) return;
      // Text copied with a picture (Word, a web page) into a field stays text.
      if (e.target.closest?.("input, textarea") && [...e.clipboardData.types].includes("text/plain")) return;
      e.preventDefault();
      uploadImage(item.getAsFile());
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  // Load the form when the drawer opens, keyed on the product's id so a
  // background refetch of the menu does not wipe what is being typed.
  const editingKey = editing ? String(editing._id || "") : "";
  useEffect(() => {
    if (!open) return;
    if (editing) {
      const existingGroupNames = Array.isArray(editing?.modifierGroups)
        ? editing.modifierGroups.map((g) => g?.name).filter(Boolean)
        : [];
      setProdAssignedGroupNames(existingGroupNames);
      setProdName(editing.name || "");
      setProdDesc(editing.description || "");
      setProdPrice(String(editing.price ?? "100"));
      setProdSamePrice(editing.samePrice !== false);
      setChannelPrices({
        posCollection: String(editing.channelPrices?.posCollection ?? editing.price ?? "100"),
        posDelivery: String(editing.channelPrices?.posDelivery ?? editing.price ?? "100"),
        posTable: String(editing.channelPrices?.posTable ?? editing.price ?? "100"),
        websiteCollection: String(editing.channelPrices?.websiteCollection ?? editing.price ?? "100"),
        websiteDelivery: String(editing.channelPrices?.websiteDelivery ?? editing.price ?? "100"),
        websiteTable: String(editing.channelPrices?.websiteTable ?? editing.price ?? "100"),
      });
      setProdVeg(editing.isVegetarian !== false);
      setProdDisplay(editing.displayTarget || "both");
      setProdImageUrl(editing.imageUrl || editing.image || "");
      const dt = editing.dispatchType || { collection: true, delivery: true, table: true };
      setDispatchAll(Boolean(dt.collection && dt.delivery && dt.table));
      setDispatchCol(Boolean(dt.collection));
      setDispatchDel(Boolean(dt.delivery));
      setDispatchTbl(Boolean(dt.table));
      setProdAvailable(editing.isAvailable !== false);
      setProdOffOnPos(editing.visibleOnPosWhenOff === true);
      setProdOffOnWebsite(editing.visibleOnWebsiteWhenOff === true);
      const sch = editing.schedule || {};
      setProdScheduleEnabled(Boolean(sch.enabled));
      setProdStartTime(sch.startTime || "09:00");
      setProdEndTime(sch.endTime || "23:00");
      setProdDaysOfWeek(Array.isArray(sch.daysOfWeek) && sch.daysOfWeek.length ? sch.daysOfWeek : [0, 1, 2, 3, 4, 5, 6]);
    } else {
      setProdName("");
      setProdDesc("");
      setProdPrice("100");
      setProdSamePrice(true);
      setChannelPrices({
        posCollection: "100",
        posDelivery: "100",
        posTable: "100",
        websiteCollection: "100",
        websiteDelivery: "100",
        websiteTable: "100",
      });
      setProdVeg(true);
      setProdDisplay("both");
      setProdImageUrl("");
      setDispatchAll(true);
      setDispatchCol(true);
      setDispatchDel(true);
      setDispatchTbl(true);
      setProdAvailable(true);
      setProdOffOnPos(false);
      setProdOffOnWebsite(false);
      setProdScheduleEnabled(false);
      setProdStartTime("09:00");
      setProdEndTime("23:00");
      setProdDaysOfWeek([0, 1, 2, 3, 4, 5, 6]);
      setProdAssignedGroupNames([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingKey]);

  const handleSaveProduct = () => {
    if (!prodName.trim() || !activeCategory) {
      enqueueSnackbar("Product name is required.", { variant: "warning" });
      return;
    }

    const priceNum = Number(prodPrice);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      enqueueSnackbar("Price cannot be negative.", { variant: "warning" });
      return;
    }

    if (!prodSamePrice) {
      for (const [k, v] of Object.entries(channelPrices)) {
        if (Number(v) < 0) {
          enqueueSnackbar(`Channel price for ${k} cannot be negative.`, { variant: "warning" });
          return;
        }
      }
    }

    const dispatchType = dispatchAll
      ? { collection: true, delivery: true, table: true }
      : { collection: dispatchCol, delivery: dispatchDel, table: dispatchTbl };

    const schedule = {
      enabled: prodScheduleEnabled,
      startTime: prodStartTime || "09:00",
      endTime: prodEndTime || "23:00",
      daysOfWeek: prodDaysOfWeek,
    };

    const payload = {
      menuId: activeCategory?._id,
      category: activeCategory?.name || "",
      subcategory: activeSubcategory || undefined,
      name: prodName,
      price: priceNum,
      description: prodDesc,
      dispatchType,
      // The product form has no colour fields; the category's used to leak in.
      bgColor: "#0249fd",
      textColor: "#ffffff",
      samePrice: prodSamePrice,
      channelPrices: prodSamePrice
        ? undefined
        : {
            posCollection: Number(channelPrices.posCollection) || priceNum,
            posDelivery: Number(channelPrices.posDelivery) || priceNum,
            posTable: Number(channelPrices.posTable) || priceNum,
            websiteCollection: Number(channelPrices.websiteCollection) || priceNum,
            websiteDelivery: Number(channelPrices.websiteDelivery) || priceNum,
            websiteTable: Number(channelPrices.websiteTable) || priceNum,
          },
      isVegetarian: prodVeg,
      displayTarget: prodDisplay,
      visibleOnPosWhenOff: prodAvailable ? false : prodOffOnPos,
      visibleOnWebsiteWhenOff: prodAvailable ? false : prodOffOnWebsite,
      imageUrl: prodImageUrl,
      isAvailable: prodAvailable,
      schedule,
      modifierGroups: prodAssignedGroupNames
        .map((name) => {
          const g = allGroupsMap.get(name);
          if (!g) return { name, required: false, maxSelections: 1, options: [] };
          return {
            name: g.name,
            required: Boolean(g.required),
            maxSelections: g.maxSelections || 1,
            options: Array.isArray(g.options) ? g.options : [],
          };
        }),
    };

    if (editingProduct) {
      updateDishMut.mutate({ ...payload, itemId: editingProduct._id });
    } else {
      addDishMut.mutate(payload);
    }
  };

  return (
    <>
    {/* Drawer: Create / Edit Product Slide-Over Drawer */}
    {showCreateProduct && (
      <div className="fixed inset-0 z-[100] bg-black/50 flex justify-end">
        <div className="w-full max-w-[420px] bg-white h-full shadow-2xl flex flex-col p-6 overflow-y-auto text-[#0F172A]">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-4 mb-4">
            <h3 className="text-[18px] font-extrabold">
              {editingProduct ? "Edit Product" : "Create Product"}
            </h3>
            <button
              onClick={onClose}
              className="text-[#94A3B8] hover:text-[#0F172A]"
            >
              <IconX />
            </button>
          </div>
  
          <div className="space-y-4 flex-1 text-[13px]">
            <div>
              <label className="text-[12px] font-extrabold text-[#334155]">Menu Name</label>
              <input
                value={prodName}
                onChange={(e) => setProdName(e.target.value)}
                placeholder="e.g. Margherita Pizza"
                className="w-full h-[40px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[13.5px]"
              />
            </div>
  
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-extrabold text-[#334155]">Product Description</label>
  
              </div>
              <textarea
                maxLength={200}
                rows={2}
                value={prodDesc}
                onChange={(e) => setProdDesc(e.target.value)}
                placeholder="Description..."
                className="w-full p-3 mt-1 rounded-xl border border-[#E2E8F0] font-medium text-[13px] resize-none"
              />
            </div>
  
            <div className="space-y-2 pt-2 border-t border-[#E2E8F0]">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-[13px] text-[#0F172A]">Dispatch Type</span>
                <label className="flex items-center gap-2 font-bold text-[12px] text-[#64748B]">
                  <span>All</span>
                  <input
                    type="checkbox"
                    checked={dispatchAll}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setDispatchAll(val);
                      setDispatchCol(val);
                      setDispatchDel(val);
                      setDispatchTbl(val);
                    }}
                    className="w-5 h-5 accent-[#22C55E]"
                  />
                </label>
              </div>
  
              {!dispatchAll && (
                <div className="grid grid-cols-3 gap-2 pt-1 text-[12px]">
                  {[
                    { label: "Collection", on: dispatchCol, set: setDispatchCol },
                    { label: "Delivery", on: dispatchDel, set: setDispatchDel },
                    { label: "Table", on: dispatchTbl, set: setDispatchTbl },
                  ].map(({ label, on, set }) => (
                    <label
                      key={label}
                      className="flex items-center gap-1.5 p-2 rounded-lg bg-[#F8FAFC] border font-bold"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => set(e.target.checked)}
                        className="accent-[#FD5302]"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
  
            {/* Product Image Click-to-Upload / Replace / Remove */}
            <div className="pt-2 border-t border-[#E2E8F0]">
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-extrabold text-[#334155]">Product Image</label>
                {prodImageUrl && (
                  <button
                    type="button"
                    onClick={() => setProdImageUrl("")}
                    className="text-[11px] font-bold text-[#DC2626] hover:underline"
                  >
                    Remove Image
                  </button>
                )}
              </div>
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  uploadImage(e.dataTransfer.files?.[0]);
                }}
                className={`mt-1 w-full h-[110px] rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer hover:border-[#FD5302] hover:bg-[#FFF1E8]/30 transition-all text-center p-2 relative overflow-hidden ${
                  dragOver ? "border-[#FD5302] bg-[#FFF1E8]" : "border-[#CBD5E1] bg-[#F8FAFC]"
                }`}
              >
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploadingImg}
                  onChange={(e) => {
                    uploadImage(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                {uploadingImg ? (
                  <span className="text-[12px] font-bold text-[#C2410C] animate-pulse">Uploading image…</span>
                ) : prodImageUrl ? (
                  <div className="relative h-full w-full flex items-center justify-center">
                    <img src={prodImageUrl} alt="Product" className="h-full object-contain rounded-lg" />
                    <span className="absolute bottom-1 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
                      Click, paste or drop to replace
                    </span>
                  </div>
                ) : (
                  <>
                    <span className="text-2xl">📸</span>
                    <span className="text-[11.5px] font-bold text-[#C2410C] mt-1">Click, paste (Ctrl+V) or drop an image</span>
                    <span className="text-[10px] text-[#94A3B8] font-semibold">Any format. Saved as WebP, about 200 KB</span>
                  </>
                )}
              </label>
            </div>
  
            {/* Veg / Non-Veg & Display Target & Availability Status */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#E2E8F0]">
              <div>
                <label className="text-[12px] font-extrabold text-[#334155]">Dietary</label>
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setProdVeg(true)}
                    className={`flex-1 h-[36px] rounded-xl font-bold text-[12px] border ${
                      prodVeg ? "bg-[#DCFCE7] border-[#22C55E] text-[#15803D]" : "border-[#E2E8F0] text-[#64748B]"
                    }`}
                  >
                    Veg
                  </button>
                  <button
                    type="button"
                    onClick={() => setProdVeg(false)}
                    className={`flex-1 h-[36px] rounded-xl font-bold text-[12px] border ${
                      !prodVeg ? "bg-[#FEE2E2] border-[#EF4444] text-[#B91C1C]" : "border-[#E2E8F0] text-[#64748B]"
                    }`}
                  >
                    Non-Veg
                  </button>
                </div>
              </div>
  
              <div>
                <label className="text-[12px] font-extrabold text-[#334155]">Display Target</label>
                <select
                  value={prodDisplay}
                  onChange={(e) => setProdDisplay(e.target.value)}
                  className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[12.5px]"
                >
                  <option value="both">Both (System & Website)</option>
                  <option value="system">System (POS Only)</option>
                  <option value="website">Website Only</option>
                </select>
              </div>
            </div>
  
            {/* Display ON/OFF availability toggle switch */}
            <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0]">
              <div>
                <span className="font-extrabold text-[13px] text-[#0F172A] block">Display Status</span>
                <span className="text-[11px] text-[#64748B]">
                  {prodAvailable ? "Display ON — Available for ordering" : "Display OFF — Hidden / Out of stock"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setProdAvailable((prev) => !prev)}
                className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
                  prodAvailable ? "bg-[#22C55E]" : "bg-[#CBD5E1]"
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    prodAvailable ? "right-1" : "left-1"
                  }`}
                />
              </button>
            </div>
  
            {/* Display OFF removes the product from both surfaces by
                default; these keep it live on one of them. */}
            {!prodAvailable && (
              <div className="space-y-2 pl-1">
                {[
                  { label: "POS Visibility", hint: "Keep selling on the POS tills only", on: prodOffOnPos, set: setProdOffOnPos },
                  { label: "Website Visibility", hint: "Keep selling on the customer website only", on: prodOffOnWebsite, set: setProdOffOnWebsite },
                ].map(({ label, hint, on, set }) => (
                  <div key={label} className="flex items-center justify-between">
                    <div>
                      <span className="font-bold text-[12.5px] text-[#334155] block">{label}</span>
                      <span className="text-[11px] text-[#94A3B8]">{hint}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => set((prev) => !prev)}
                      className={`w-10 h-[22px] rounded-full transition-colors relative shrink-0 ${
                        on ? "bg-[#22C55E]" : "bg-[#CBD5E1]"
                      }`}
                    >
                      <span
                        className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-transform ${
                          on ? "right-[3px]" : "left-[3px]"
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            )}
  
            {/* Assign Groups (Module 8) */}
            <div className="pt-2 border-t border-[#E2E8F0] space-y-2">
              <div>
                <label className="text-[12px] font-extrabold text-[#334155] block">Assign Groups / Components</label>
                <span className="text-[11px] font-medium text-[#64748B]">Groups appear in the exact order you select them</span>
              </div>
              {groupsList.length === 0 ? (
                <p className="text-[11.5px] text-[#94A3B8]">No groups created yet.</p>
              ) : (
                <div className="space-y-2">
                  <div className="max-h-[140px] overflow-y-auto space-y-1.5 p-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                    {groupsList.map((g) => {
                      const orderIndex = prodAssignedGroupNames.indexOf(g.name);
                      const checked = orderIndex !== -1;
                      return (
                        <label key={g.name} className="flex items-center justify-between p-1.5 hover:bg-white rounded-lg cursor-pointer text-[12px] font-bold text-[#334155]">
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                if (checked) {
                                  setProdAssignedGroupNames(prodAssignedGroupNames.filter((n) => n !== g.name));
                                } else {
                                  setProdAssignedGroupNames([...prodAssignedGroupNames, g.name]);
                                }
                              }}
                              className="w-4 h-4 accent-[#FD5302] shrink-0"
                            />
                            <span className="truncate">{g.name}</span>
                            {checked && (
                              <span className="px-1.5 py-0.2 rounded-full bg-[#FD5302] text-white text-[10px] font-extrabold shrink-0">
                                #{orderIndex + 1}
                              </span>
                            )}
                          </div>
                          <span className="text-[10.5px] font-semibold text-[#64748B] shrink-0">{(g.options || []).length} Components</span>
                        </label>
                      );
                    })}
                  </div>
  
                  {prodAssignedGroupNames.length > 0 && (
                    <div className="p-2.5 rounded-xl bg-[#FFF1E8]/60 border border-[#FFD5BE] space-y-1">
                      <span className="text-[11px] font-extrabold text-[#C2410C] uppercase tracking-wider block">
                        Attached Order ({prodAssignedGroupNames.length})
                      </span>
                      <div className="space-y-1">
                        {prodAssignedGroupNames.map((name, idx) => (
                          <div key={name} className="flex items-center justify-between px-2 py-0.5 rounded bg-white border border-[#E2E8F0] text-[11.5px] font-bold text-[#0F172A]">
                            <span className="truncate">#{idx + 1} {name}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              {idx > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const next = [...prodAssignedGroupNames];
                                    const temp = next[idx - 1];
                                    next[idx - 1] = next[idx];
                                    next[idx] = temp;
                                    setProdAssignedGroupNames(next);
                                  }}
                                  className="w-4 h-4 rounded text-[#C2410C] hover:bg-[#FFF1E8] text-[10px]"
                                >▲</button>
                              )}
                              {idx < prodAssignedGroupNames.length - 1 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const next = [...prodAssignedGroupNames];
                                    const temp = next[idx + 1];
                                    next[idx + 1] = next[idx];
                                    next[idx] = temp;
                                    setProdAssignedGroupNames(next);
                                  }}
                                  className="w-4 h-4 rounded text-[#C2410C] hover:bg-[#FFF1E8] text-[10px]"
                                >▼</button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
  
            {/* Product Time & Availability Schedule (Module 4) */}
            <div className="pt-2 border-t border-[#E2E8F0] space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-extrabold text-[13px] text-[#0F172A] block">Product Time & Schedule</span>
                  <span className="text-[11px] text-[#64748B]">Set time-based availability</span>
                </div>
                <input
                  type="checkbox"
                  checked={prodScheduleEnabled}
                  onChange={(e) => setProdScheduleEnabled(e.target.checked)}
                  className="w-5 h-5 accent-[#22C55E]"
                />
              </div>
  
              {prodScheduleEnabled && (
                <div className="space-y-3 p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[12px]">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="font-bold text-[#64748B]">Available From</label>
                      <input
                        type="time"
                        value={prodStartTime}
                        onChange={(e) => setProdStartTime(e.target.value)}
                        className="w-full h-[34px] px-2 mt-0.5 rounded-lg border border-[#CBD5E1] font-bold text-[12px]"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[#64748B]">Available Until</label>
                      <input
                        type="time"
                        value={prodEndTime}
                        onChange={(e) => setProdEndTime(e.target.value)}
                        className="w-full h-[34px] px-2 mt-0.5 rounded-lg border border-[#CBD5E1] font-bold text-[12px]"
                      />
                    </div>
                  </div>
  
                  <div>
                    <label className="font-bold text-[#64748B] block mb-1">Active Days</label>
                    <div className="flex gap-1">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName, idx) => {
                        const active = prodDaysOfWeek.includes(idx);
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              if (active) setProdDaysOfWeek(prodDaysOfWeek.filter((d) => d !== idx));
                              else setProdDaysOfWeek([...prodDaysOfWeek, idx].sort());
                            }}
                            className={`flex-1 h-[28px] rounded text-[10.5px] font-extrabold border ${
                              active ? "bg-[#FD5302] text-white border-[#FD5302]" : "bg-white text-[#64748B] border-[#CBD5E1]"
                            }`}
                          >
                            {dayName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
  
            {/* Price & Separate Channel Prices (Module 2 §3 & §4) */}
            <div className="pt-2 border-t border-[#E2E8F0] space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[13px] font-extrabold text-[#0F172A]">Same Price for All Channels</label>
                <input
                  type="checkbox"
                  checked={prodSamePrice}
                  onChange={(e) => setProdSamePrice(e.target.checked)}
                  className="w-5 h-5 accent-[#22C55E]"
                />
              </div>
  
              {prodSamePrice ? (
                <div>
                  <label className="text-[11.5px] font-bold text-[#94A3B8]">Product Price (₹)</label>
                  <input
                    type="number"
                    min={0}
                    value={prodPrice}
                    onChange={(e) => setProdPrice(e.target.value)}
                    className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold"
                  />
                </div>
              ) : (
                <div className="space-y-3 p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                  <p className="text-[11.5px] font-bold text-[#C2410C]">Separate Prices (POS vs Website)</p>
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <label className="font-bold text-[#64748B]">POS Collection</label>
                      <input
                        type="number"
                        min={0}
                        value={channelPrices.posCollection}
                        onChange={(e) => setChannelPrices({ ...channelPrices, posCollection: e.target.value })}
                        className="w-full h-[32px] px-2 rounded-lg border border-[#CBD5E1] font-bold"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[#64748B]">POS Delivery</label>
                      <input
                        type="number"
                        min={0}
                        value={channelPrices.posDelivery}
                        onChange={(e) => setChannelPrices({ ...channelPrices, posDelivery: e.target.value })}
                        className="w-full h-[32px] px-2 rounded-lg border border-[#CBD5E1] font-bold"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[#64748B]">POS Table</label>
                      <input
                        type="number"
                        min={0}
                        value={channelPrices.posTable}
                        onChange={(e) => setChannelPrices({ ...channelPrices, posTable: e.target.value })}
                        className="w-full h-[32px] px-2 rounded-lg border border-[#CBD5E1] font-bold"
                      />
                    </div>
  
                    <div>
                      <label className="font-bold text-[#64748B]">Web Collection</label>
                      <input
                        type="number"
                        min={0}
                        value={channelPrices.websiteCollection}
                        onChange={(e) => setChannelPrices({ ...channelPrices, websiteCollection: e.target.value })}
                        className="w-full h-[32px] px-2 rounded-lg border border-[#CBD5E1] font-bold"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[#64748B]">Web Delivery</label>
                      <input
                        type="number"
                        min={0}
                        value={channelPrices.websiteDelivery}
                        onChange={(e) => setChannelPrices({ ...channelPrices, websiteDelivery: e.target.value })}
                        className="w-full h-[32px] px-2 rounded-lg border border-[#CBD5E1] font-bold"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[#64748B]">Web Table</label>
                      <input
                        type="number"
                        min={0}
                        value={channelPrices.websiteTable}
                        onChange={(e) => setChannelPrices({ ...channelPrices, websiteTable: e.target.value })}
                        className="w-full h-[32px] px-2 rounded-lg border border-[#CBD5E1] font-bold"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
  
          <div className="pt-4 border-t border-[#E2E8F0]">
            <button
              onClick={handleSaveProduct}
              disabled={addDishMut.isPending || updateDishMut.isPending}
              className="w-full h-[46px] rounded-xl bg-[#0F172A] text-white text-[14px] font-extrabold shadow-lg hover:bg-[#1E293B] disabled:opacity-50"
            >
              {addDishMut.isPending || updateDishMut.isPending ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default ProductDrawer;
