import React, { useState } from "react";
import { motion } from "framer-motion";
import { IoMdClose } from "react-icons/io";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addVariant,
  addAddon,
  addModifierGroup,
  toggleCombo,
  addPriceRule,
  updateItemSchedule,
  updateMenuSchedule,
} from "../../https";
import { enqueueSnackbar } from "notistack";

const DAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

const MenuFeatureModal = ({ type, menu, item, onClose }) => {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    // Variant / Addon / Modifier
    name: "",
    price: "",
    required: false,
    maxSelections: 1,
    options: "",
    // Combo
    comboDescription: "",
    comboItems: "",
    // Pricing Rule
    ruleName: "",
    rulePrice: "",
    startTime: "00:00",
    endTime: "23:59",
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    // Schedule
    enabled: false,
    scheduleStart: "09:00",
    scheduleEnd: "23:00",
  });
  const [optionsList, setOptionsList] = useState([]);
  const [optionName, setOptionName] = useState("");
  const [optionPrice, setOptionPrice] = useState("");

  const invalidateMenus = () => queryClient.invalidateQueries({ queryKey: ["menus"] });

  const mutation = useMutation({
    mutationFn: async (payload) => {
      switch (type) {
        case "variant":
          return addVariant(payload);
        case "addon":
          return addAddon(payload);
        case "modifier":
          return addModifierGroup(payload);
        case "combo":
          return toggleCombo(payload);
        case "pricing":
          return addPriceRule(payload);
        case "item-schedule":
          return updateItemSchedule(payload);
        case "menu-schedule":
          return updateMenuSchedule(payload);
        default:
          throw new Error("Unknown type");
      }
    },
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Saved successfully!", { variant: "success" });
      invalidateMenus();
      onClose();
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to save.", { variant: "error" });
    },
  });

  const handleInputChange = (e) => {
    const { name, value, type: inputType, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: inputType === "checkbox" ? checked : value,
    }));
  };

  const handleDaysToggle = (day) => {
    setFormData((prev) => {
      const has = prev.daysOfWeek.includes(day);
      return {
        ...prev,
        daysOfWeek: has
          ? prev.daysOfWeek.filter((d) => d !== day)
          : [...prev.daysOfWeek, day].sort(),
      };
    });
  };

  const handleAddOption = () => {
    if (!optionName.trim()) return;
    setOptionsList((prev) => [
      ...prev,
      { name: optionName.trim(), price: Number(optionPrice || 0) },
    ]);
    setOptionName("");
    setOptionPrice("");
  };

  const handleRemoveOption = (index) => {
    setOptionsList((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const base = { menuId: menu?._id, itemId: item?._id };

    switch (type) {
      case "variant":
        if (!formData.name || !formData.price) {
          enqueueSnackbar("Variant name and price are required!", { variant: "warning" });
          return;
        }
        mutation.mutate({ ...base, name: formData.name, price: formData.price });
        break;

      case "addon":
        if (!formData.name) {
          enqueueSnackbar("Add-on name is required!", { variant: "warning" });
          return;
        }
        mutation.mutate({ ...base, name: formData.name, price: formData.price || 0 });
        break;

      case "modifier":
        if (!formData.name) {
          enqueueSnackbar("Modifier group name is required!", { variant: "warning" });
          return;
        }
        mutation.mutate({
          ...base,
          name: formData.name,
          required: formData.required,
          maxSelections: formData.maxSelections,
          options: optionsList,
        });
        break;

      case "combo":
        mutation.mutate({
          ...base,
          comboDescription: formData.comboDescription,
          comboItems: formData.comboItems
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        });
        break;

      case "pricing":
        if (!formData.ruleName || !formData.rulePrice) {
          enqueueSnackbar("Rule name and price are required!", { variant: "warning" });
          return;
        }
        mutation.mutate({
          ...base,
          name: formData.ruleName,
          price: formData.rulePrice,
          startTime: formData.startTime,
          endTime: formData.endTime,
          daysOfWeek: formData.daysOfWeek,
        });
        break;

      case "item-schedule":
        mutation.mutate({
          ...base,
          enabled: formData.enabled,
          startTime: formData.scheduleStart,
          endTime: formData.scheduleEnd,
          daysOfWeek: formData.daysOfWeek,
        });
        break;

      case "menu-schedule":
        mutation.mutate({
          menuId: menu?._id,
          enabled: formData.enabled,
          startTime: formData.scheduleStart,
          endTime: formData.scheduleEnd,
          daysOfWeek: formData.daysOfWeek,
        });
        break;

      default:
        break;
    }
  };

  const titles = {
    variant: `Add Variant - ${item?.name}`,
    addon: `Add Add-on - ${item?.name}`,
    modifier: `Add Modifier Group - ${item?.name}`,
    combo: item?.isCombo ? `Remove Combo - ${item?.name}` : `Make Combo - ${item?.name}`,
    pricing: `Add Pricing Rule - ${item?.name}`,
    "item-schedule": `Schedule Availability - ${item?.name}`,
    "menu-schedule": `Time-based Menu - ${menu?.name}`,
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 10 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-secondary rounded-2xl shadow-2xl w-full max-w-lg mx-4 border border-border overflow-y-auto max-h-[90vh]"
      >
        <div className="flex justify-between items-center px-6 py-4 border-b border-border sticky top-0 bg-surface-secondary">
          <h2 className="font-display text-lg text-content font-semibold">
            {titles[type]}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-content-muted hover:text-accent-red hover:bg-surface-tertiary transition-all"
          >
            <IoMdClose size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Variant */}
          {type === "variant" && (
            <>
              <div>
                <label className="block text-content-muted mb-2 text-sm font-medium">
                  Variant Name <span className="text-accent-red">*</span>
                </label>
                <div className="input-container">
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="e.g. Small, Medium, Large"
                    className="input-field"
                  />
                </div>
              </div>
              <div>
                <label className="block text-content-muted mb-2 text-sm font-medium">
                  Variant Price (₹) <span className="text-accent-red">*</span>
                </label>
                <div className="input-container">
                  <input
                    type="number"
                    name="price"
                    value={formData.price}
                    onChange={handleInputChange}
                    placeholder="e.g. 199"
                    className="input-field"
                  />
                </div>
              </div>
            </>
          )}

          {/* Add-on */}
          {type === "addon" && (
            <>
              <div>
                <label className="block text-content-muted mb-2 text-sm font-medium">
                  Add-on Name <span className="text-accent-red">*</span>
                </label>
                <div className="input-container">
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="e.g. Extra Cheese, Extra Sauce"
                    className="input-field"
                  />
                </div>
              </div>
              <div>
                <label className="block text-content-muted mb-2 text-sm font-medium">
                  Add-on Price (₹)
                </label>
                <div className="input-container">
                  <input
                    type="number"
                    name="price"
                    value={formData.price}
                    onChange={handleInputChange}
                    placeholder="e.g. 30"
                    className="input-field"
                  />
                </div>
              </div>
            </>
          )}

          {/* Modifier Group */}
          {type === "modifier" && (
            <>
              <div>
                <label className="block text-content-muted mb-2 text-sm font-medium">
                  Modifier Group Name <span className="text-accent-red">*</span>
                </label>
                <div className="input-container">
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="e.g. Extra Toppings"
                    className="input-field"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm text-content-medium">
                  <input
                    type="checkbox"
                    name="required"
                    checked={formData.required}
                    onChange={handleInputChange}
                    className="w-4 h-4 accent-accent"
                  />
                  Required
                </label>
                <div>
                  <label className="block text-content-muted mb-1 text-xs font-medium">
                    Max Selections
                  </label>
                  <div className="input-container !py-2">
                    <input
                      type="number"
                      name="maxSelections"
                      value={formData.maxSelections}
                      onChange={handleInputChange}
                      min="1"
                      className="input-field"
                    />
                  </div>
                </div>
              </div>

              {/* Options */}
              <div>
                <label className="block text-content-muted mb-2 text-sm font-medium">
                  Options
                </label>
                <div className="flex gap-2 mb-2">
                  <div className="input-container flex-1 !py-2">
                    <input
                      type="text"
                      value={optionName}
                      onChange={(e) => setOptionName(e.target.value)}
                      placeholder="Option name"
                      className="input-field"
                    />
                  </div>
                  <div className="input-container !py-2 w-24">
                    <input
                      type="number"
                      value={optionPrice}
                      onChange={(e) => setOptionPrice(e.target.value)}
                      placeholder="Price"
                      className="input-field"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddOption}
                    className="btn-primary !py-2 !px-4 text-sm shrink-0"
                  >
                    Add
                  </button>
                </div>
                {optionsList.length > 0 && (
                  <div className="space-y-1.5 mt-2">
                    {optionsList.map((opt, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between bg-surface-input border border-border rounded-lg px-3 py-2"
                      >
                        <span className="text-sm text-content">
                          {opt.name}
                          {opt.price > 0 && (
                            <span className="text-content-muted"> · +₹{opt.price}</span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveOption(idx)}
                          className="text-accent-red hover:text-accent-red/70 text-sm"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {optionsList.length === 0 && (
                  <p className="text-xs text-content-muted">No options added yet.</p>
                )}
              </div>
            </>
          )}

          {/* Combo */}
          {type === "combo" && !item?.isCombo && (
            <>
              <div>
                <label className="block text-content-muted mb-2 text-sm font-medium">
                  Combo Description
                </label>
                <div className="input-container">
                  <input
                    type="text"
                    name="comboDescription"
                    value={formData.comboDescription}
                    onChange={handleInputChange}
                    placeholder="e.g. Burger + Fries + Drink"
                    className="input-field"
                  />
                </div>
              </div>
              <div>
                <label className="block text-content-muted mb-2 text-sm font-medium">
                  Included Items (comma separated)
                </label>
                <div className="input-container">
                  <input
                    type="text"
                    name="comboItems"
                    value={formData.comboItems}
                    onChange={handleInputChange}
                    placeholder="e.g. Regular Burger, Medium Fries, Soft Drink"
                    className="input-field"
                  />
                </div>
              </div>
            </>
          )}
          {type === "combo" && item?.isCombo && (
            <p className="text-sm text-content-muted">
              Click save to remove this item from combo meals.
            </p>
          )}

          {/* Pricing Rule */}
          {type === "pricing" && (
            <>
              <div>
                <label className="block text-content-muted mb-2 text-sm font-medium">
                  Rule Name <span className="text-accent-red">*</span>
                </label>
                <div className="input-container">
                  <input
                    type="text"
                    name="ruleName"
                    value={formData.ruleName}
                    onChange={handleInputChange}
                    placeholder="e.g. Happy Hour, Weekend Special"
                    className="input-field"
                  />
                </div>
              </div>
              <div>
                <label className="block text-content-muted mb-2 text-sm font-medium">
                  Rule Price (₹) <span className="text-accent-red">*</span>
                </label>
                <div className="input-container">
                  <input
                    type="number"
                    name="rulePrice"
                    value={formData.rulePrice}
                    onChange={handleInputChange}
                    placeholder="e.g. 199"
                    className="input-field"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-content-muted mb-1 text-xs font-medium">
                    Start Time
                  </label>
                  <div className="input-container !py-2">
                    <input
                      type="time"
                      name="startTime"
                      value={formData.startTime}
                      onChange={handleInputChange}
                      className="input-field"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-content-muted mb-1 text-xs font-medium">
                    End Time
                  </label>
                  <div className="input-container !py-2">
                    <input
                      type="time"
                      name="endTime"
                      value={formData.endTime}
                      onChange={handleInputChange}
                      className="input-field"
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-content-muted mb-2 text-sm font-medium">
                  Days of Week
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => handleDaysToggle(day.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                        formData.daysOfWeek.includes(day.value)
                          ? "bg-accent text-white border-accent"
                          : "bg-surface-input border-border text-content-muted hover:border-accent"
                      }`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Item Schedule */}
          {type === "item-schedule" && (
            <>
              <label className="flex items-center gap-2 text-sm text-content-medium">
                <input
                  type="checkbox"
                  name="enabled"
                  checked={formData.enabled}
                  onChange={handleInputChange}
                  className="w-4 h-4 accent-accent"
                />
                Enable scheduled availability
              </label>
              {formData.enabled && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-content-muted mb-1 text-xs font-medium">
                        Available From
                      </label>
                      <div className="input-container !py-2">
                        <input
                          type="time"
                          name="scheduleStart"
                          value={formData.scheduleStart}
                          onChange={handleInputChange}
                          className="input-field"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-content-muted mb-1 text-xs font-medium">
                        Available Until
                      </label>
                      <div className="input-container !py-2">
                        <input
                          type="time"
                          name="scheduleEnd"
                          value={formData.scheduleEnd}
                          onChange={handleInputChange}
                          className="input-field"
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-content-muted mb-2 text-sm font-medium">
                      Days of Week
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {DAYS.map((day) => (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => handleDaysToggle(day.value)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                            formData.daysOfWeek.includes(day.value)
                              ? "bg-accent text-white border-accent"
                              : "bg-surface-input border-border text-content-muted hover:border-accent"
                          }`}
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* Menu Schedule */}
          {type === "menu-schedule" && (
            <>
              <label className="flex items-center gap-2 text-sm text-content-medium">
                <input
                  type="checkbox"
                  name="enabled"
                  checked={formData.enabled}
                  onChange={handleInputChange}
                  className="w-4 h-4 accent-accent"
                />
                Enable time-based menu
              </label>
              {formData.enabled && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-content-muted mb-1 text-xs font-medium">
                        Menu Visible From
                      </label>
                      <div className="input-container !py-2">
                        <input
                          type="time"
                          name="scheduleStart"
                          value={formData.scheduleStart}
                          onChange={handleInputChange}
                          className="input-field"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-content-muted mb-1 text-xs font-medium">
                        Menu Visible Until
                      </label>
                      <div className="input-container !py-2">
                        <input
                          type="time"
                          name="scheduleEnd"
                          value={formData.scheduleEnd}
                          onChange={handleInputChange}
                          className="input-field"
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-content-muted mb-2 text-sm font-medium">
                      Days of Week
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {DAYS.map((day) => (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() => handleDaysToggle(day.value)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                            formData.daysOfWeek.includes(day.value)
                              ? "bg-accent text-white border-accent"
                              : "bg-surface-input border-border text-content-muted hover:border-accent"
                          }`}
                        >
                          {day.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          <button
            type="submit"
            disabled={mutation.isPending}
            className="btn-primary w-full mt-6 disabled:opacity-50"
          >
            {mutation.isPending ? "Saving..." : "Save"}
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
};

export default MenuFeatureModal;