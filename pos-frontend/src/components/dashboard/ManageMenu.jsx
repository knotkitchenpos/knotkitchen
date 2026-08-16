import React, { useState } from "react";
import {
  FiTrash2,
  FiXCircle,
  FiCheckCircle,
  FiPlus,
  FiClock,
  FiUploadCloud,
  FiLayers,
  FiGift,
  FiMoreHorizontal,
  FiPercent,
  FiFileText,
} from "react-icons/fi";

import {
  MdOutlineSchedule,
} from "react-icons/md";
import { BiLayer } from "react-icons/bi";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMenus,
  deleteCategory,
  deleteDish,
  updateDishStatus,
  deleteVariant,
  deleteAddon,
  deleteModifierGroup,
  deletePriceRule,
} from "../../https";
import { enqueueSnackbar } from "notistack";
import MenuFeatureModal from "./MenuFeatureModal";
import MenuPublishModal from "./MenuPublishModal";
import MenuTextImportModal from "./MenuTextImportModal";
import DeleteCategoryModal from "../pos/DeleteCategoryModal";


const itemActions = [
  { key: "variant", label: "Add Variant", icon: <FiLayers size={14} /> },
  { key: "addon", label: "Add Add-on", icon: <FiPlus size={14} /> },
  { key: "modifier", label: "Modifier Group", icon: <BiLayer size={14} /> },
  { key: "combo", label: "Toggle Combo", icon: <FiGift size={14} /> },
  { key: "pricing", label: "Pricing Rule", icon: <FiPercent size={14} /> },
  { key: "item-schedule", label: "Schedule", icon: <FiClock size={14} /> },
];

const menuActions = [
  { key: "menu-schedule", label: "Time-based Menu", icon: <MdOutlineSchedule size={14} /> },
  { key: "publish", label: "Publish / Versions", icon: <FiUploadCloud size={14} /> },
];

const ManageMenu = () => {
  const queryClient = useQueryClient();

  const [featureModal, setFeatureModal] = useState(null); // { type, menuId, itemId }
  const [publishModalMenu, setPublishModalMenu] = useState(null);
  const [openItemMenu, setOpenItemMenu] = useState(null); // menuId-itemId
  const [showTextImport, setShowTextImport] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState(null);


  const { data: menusRes } = useQuery({
    queryKey: ["menus"],
    queryFn: getMenus,
  });

  const menus = menusRes?.data?.data || [];

  const invalidateMenus = () => queryClient.invalidateQueries({ queryKey: ["menus"] });

  const deleteCategoryMutation = useMutation({
    mutationFn: deleteCategory,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Category deleted successfully!", { variant: "success" });
      invalidateMenus();
      queryClient.invalidateQueries({ queryKey: ["popular-items"] });
      setCategoryToDelete(null);
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to delete category.", { variant: "error" });
    },
  });

  const deleteDishMutation = useMutation({
    mutationFn: deleteDish,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Dish deleted successfully!", { variant: "success" });
      invalidateMenus();
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to delete dish.", { variant: "error" });
    },
  });

  const toggleDishMutation = useMutation({
    mutationFn: updateDishStatus,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Dish status updated!", { variant: "success" });
      invalidateMenus();
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to update dish status.", { variant: "error" });
    },
  });

  const deleteVariantMutation = useMutation({
    mutationFn: deleteVariant,
    onSuccess: () => {
      enqueueSnackbar("Variant deleted!", { variant: "success" });
      invalidateMenus();
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to delete variant.", { variant: "error" });
    },
  });

  const deleteAddonMutation = useMutation({
    mutationFn: deleteAddon,
    onSuccess: () => {
      enqueueSnackbar("Add-on deleted!", { variant: "success" });
      invalidateMenus();
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to delete add-on.", { variant: "error" });
    },
  });

  const deleteModifierMutation = useMutation({
    mutationFn: deleteModifierGroup,
    onSuccess: () => {
      enqueueSnackbar("Modifier group deleted!", { variant: "success" });
      invalidateMenus();
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to delete modifier group.", { variant: "error" });
    },
  });

  const deletePriceRuleMutation = useMutation({
    mutationFn: deletePriceRule,
    onSuccess: () => {
      enqueueSnackbar("Pricing rule deleted!", { variant: "success" });
      invalidateMenus();
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to delete pricing rule.", { variant: "error" });
    },
  });

  const handleDeleteDish = (menuId, itemId, dishName) => {
    if (window.confirm(`Are you sure you want to remove "${dishName}" from the menu?`)) {
      deleteDishMutation.mutate({ menuId, itemId });
    }
  };

  const handleToggleDish = (menuId, itemId) => {
    toggleDishMutation.mutate({ menuId, itemId });
  };

  const handleFeatureAction = (type, menu, item) => {
    setFeatureModal({ type, menu, item });
  };

  const handleMenuAction = (key, menu) => {
    if (key === "menu-schedule") {
      setFeatureModal({ type: "menu-schedule", menu });
    } else if (key === "publish") {
      setPublishModalMenu(menu);
    }
  };

  const isItemScheduled = (item) => item?.schedule?.enabled || false;
  const isMenuScheduled = (menu) => menu?.schedule?.enabled || false;
  const isCombo = (item) => item?.isCombo || false;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold text-content text-xl font-display">Manage Menu</h2>
          <p className="text-sm text-content-muted">
            Manage dishes, variants, add-ons, modifier groups, combos, pricing rules, scheduling, and publishing.
          </p>
        </div>

        <button
          onClick={() => setShowTextImport(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:opacity-90 transition-opacity shrink-0"
        >
          <FiFileText size={16} />
          Import Menu
        </button>
      </div>

      {menus.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-content-muted">
            No menu categories yet. Add a category and dishes to get started.
          </p>
          <p className="text-sm text-content-muted mt-2">
            Have the menu written down? Use{" "}
            <button
              onClick={() => setShowTextImport(true)}
              className="text-accent hover:underline font-medium"
            >
              Import Menu
            </button>{" "}
            to build it from a Notepad file.
          </p>
        </div>
      ) : (

        menus.map((menu) => (
          <div key={menu._id} className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
            {/* Category Header */}
            <div className="px-5 py-4 bg-surface-tertiary border-b border-border flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div>
                  <h3 className="font-display font-semibold text-content text-lg">{menu.name}</h3>
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    <p className="text-xs text-content-muted">{menu.items?.length || 0} dishes</p>
                    {isMenuScheduled(menu) && (
                      <span className="px-2 py-0.5 rounded-full bg-accent-blue/10 text-accent-blue text-[10px] font-semibold flex items-center gap-1">
                        <FiClock size={10} /> Time-based
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 ${
                      menu.published !== false
                        ? "bg-accent-green/10 text-accent-green"
                        : "bg-accent-amber/10 text-accent-amber"
                    }`}>
                      {menu.published !== false ? "Published" : "Unpublished"}
                      <span className="text-content-muted">· v{menu.version || 1}</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Menu-level actions */}
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                {menuActions.map(({ key, label, icon }) => (
                  <button
                    key={key}
                    onClick={() => handleMenuAction(key, menu)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-content-secondary hover:border-accent hover:text-accent transition-colors"
                  >
                    {icon}
                    {label}
                  </button>
                ))}
                <button
                  onClick={() => setCategoryToDelete(menu)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#FECACA] text-xs font-bold text-[#DC2626] hover:bg-[#FEF2F2] transition-colors"
                  title={`Delete ${menu.name}`}
                >
                  <FiTrash2 size={14} />
                  Delete Category
                </button>
              </div>
            </div>

            {/* Dishes */}
            <div className="divide-y divide-border">
              {menu.items?.length > 0 ? (
                menu.items.map((item) => {
                  const isAvailable = item.isAvailable !== false;

                  return (
                    <div key={item._id} className="px-5 py-4">
                      {/* Item Main Row */}
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-content">{item.name}</p>
                            {isCombo(item) && (
                              <span className="px-2 py-0.5 rounded-full bg-accent-amber/10 text-accent-amber text-[10px] font-semibold flex items-center gap-1">
                                <FiGift size={10} /> Combo
                              </span>
                            )}
                            {isItemScheduled(item) && (
                              <span className="px-2 py-0.5 rounded-full bg-accent-blue/10 text-accent-blue text-[10px] font-semibold flex items-center gap-1">
                                <FiClock size={10} /> Scheduled
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-content-muted">₹{item.price}</p>
                          {item.comboDescription && isCombo(item) && (
                            <p className="text-xs text-content-muted mt-0.5">{item.comboDescription}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                            isAvailable
                              ? "bg-accent-green/10 text-accent-green"
                              : "bg-accent-red/10 text-accent-red"
                          }`}>
                            {isAvailable ? "In Stock" : "Out of Stock"}
                          </span>

                          <button
                            onClick={() => handleToggleDish(menu._id, item._id)}
                            disabled={toggleDishMutation.isPending}
                            className={`p-2 rounded-xl border transition-colors disabled:opacity-50 ${
                              isAvailable
                                ? "border-border text-accent-red hover:bg-accent-red/10"
                                : "border-border text-accent-green hover:bg-accent-green/10"
                            }`}
                            title={isAvailable ? "Mark as out of stock" : "Mark as in stock"}
                          >
                            {isAvailable ? <FiXCircle size={16} /> : <FiCheckCircle size={16} />}
                          </button>

                          <button
                            onClick={() => setOpenItemMenu(openItemMenu === `${menu._id}-${item._id}` ? null : `${menu._id}-${item._id}`)}
                            className="p-2 rounded-xl border border-border text-content-muted hover:text-accent hover:border-accent transition-colors"
                            title="More options"
                          >
                            <FiMoreHorizontal size={16} />
                          </button>

                          <button
                            onClick={() => handleDeleteDish(menu._id, item._id, item.name)}
                            disabled={deleteDishMutation.isPending}
                            className="p-2 rounded-xl border border-border text-accent-red hover:bg-accent-red/10 transition-colors disabled:opacity-50"
                            title="Remove dish from menu"
                          >
                            <FiTrash2 size={16} />
                          </button>
                        </div>
                      </div>

                      {/* Quick feature badges */}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {item.variants?.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-input border border-border text-[10px] font-medium text-content-muted">
                            <FiLayers size={10} /> {item.variants.length} Variants
                          </span>
                        )}
                        {item.addons?.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-input border border-border text-[10px] font-medium text-content-muted">
                            <FiPlus size={10} /> {item.addons.length} Add-ons
                          </span>
                        )}
                        {item.modifierGroups?.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-input border border-border text-[10px] font-medium text-content-muted">
                            <BiLayer size={10} /> {item.modifierGroups.length} Modifier Groups
                          </span>
                        )}
                        {item.priceRules?.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-input border border-border text-[10px] font-medium text-content-muted">
                            <FiPercent size={10} /> {item.priceRules.length} Pricing Rules
                          </span>
                        )}
                      </div>

                      {/* Expanded item actions */}
                      {openItemMenu === `${menu._id}-${item._id}` && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <div className="flex flex-wrap gap-2">
                            {itemActions.map(({ key, label, icon }) => (
                              <button
                                key={key}
                                onClick={() => handleFeatureAction(key, menu, item)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-content-secondary hover:border-accent hover:text-accent transition-colors"
                              >
                                {icon}
                                {label}
                              </button>
                            ))}
                          </div>

                          {/* Variants list */}
                          {item.variants?.length > 0 && (
                            <div className="mt-3">
                              <p className="text-xs font-semibold text-content-muted mb-1.5 flex items-center gap-1">
                                <FiLayers size={11} /> Variants
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {item.variants.map((v) => (
                                  <span key={v._id} className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-surface-input border border-border text-xs">
                                    <span className="text-content">{v.name}</span>
                                    <span className="text-content-muted">₹{v.price}</span>
                                    <button
                                      onClick={() => {
                                        if (window.confirm(`Delete variant "${v.name}"?`)) {
                                          deleteVariantMutation.mutate({ menuId: menu._id, itemId: item._id, variantId: v._id });
                                        }
                                      }}
                                      className="text-accent-red hover:text-accent-red/70"
                                      title="Delete variant"
                                    >
                                      <FiXCircle size={13} />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Add-ons list */}
                          {item.addons?.length > 0 && (
                            <div className="mt-3">
                              <p className="text-xs font-semibold text-content-muted mb-1.5 flex items-center gap-1">
                                <FiPlus size={11} /> Add-ons
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {item.addons.map((a) => (
                                  <span key={a._id} className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-surface-input border border-border text-xs">
                                    <span className="text-content">{a.name}</span>
                                    <span className="text-content-muted">{a.price > 0 ? `+₹${a.price}` : "Free"}</span>
                                    <button
                                      onClick={() => {
                                        if (window.confirm(`Delete add-on "${a.name}"?`)) {
                                          deleteAddonMutation.mutate({ menuId: menu._id, itemId: item._id, addonId: a._id });
                                        }
                                      }}
                                      className="text-accent-red hover:text-accent-red/70"
                                      title="Delete add-on"
                                    >
                                      <FiXCircle size={13} />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Modifier groups list */}
                          {item.modifierGroups?.length > 0 && (
                            <div className="mt-3 space-y-2">
                              <p className="text-xs font-semibold text-content-muted flex items-center gap-1">
                                <BiLayer size={11} /> Modifier Groups
                              </p>
                              {item.modifierGroups.map((g) => (
                                <div key={g._id} className="rounded-lg border border-border bg-surface-input p-2.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-medium text-content">
                                      {g.name}
                                      <span className="text-content-muted ml-2">
                                        {g.required ? "Required" : "Optional"} · Max {g.maxSelections}
                                      </span>
                                    </p>
                                    <button
                                      onClick={() => {
                                        if (window.confirm(`Delete modifier group "${g.name}"?`)) {
                                          deleteModifierMutation.mutate({ menuId: menu._id, itemId: item._id, groupId: g._id });
                                        }
                                      }}
                                      className="text-accent-red hover:text-accent-red/70"
                                      title="Delete modifier group"
                                    >
                                      <FiXCircle size={13} />
                                    </button>
                                  </div>
                                  <div className="flex flex-wrap gap-1 mt-1.5">
                                    {g.options?.map((o, idx) => (
                                      <span key={idx} className="px-2 py-0.5 rounded bg-surface-secondary border border-border text-[10px] text-content-muted">
                                        {o.name}{o.price > 0 ? ` +₹${o.price}` : ""}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Combo info */}
                          {isCombo(item) && item.comboItems?.length > 0 && (
                            <div className="mt-3">
                              <p className="text-xs font-semibold text-content-muted mb-1.5 flex items-center gap-1">
                                <FiGift size={11} /> Combo Includes
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {item.comboItems.map((name, idx) => (
                                  <span key={idx} className="px-2.5 py-1 rounded-lg bg-surface-input border border-border text-xs text-content">
                                    {name}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Pricing rules list */}
                          {item.priceRules?.length > 0 && (
                            <div className="mt-3">
                              <p className="text-xs font-semibold text-content-muted mb-1.5 flex items-center gap-1">
                                <FiPercent size={11} /> Pricing Rules
                              </p>
                              <div className="space-y-1.5">
                                {item.priceRules.map((r) => (
                                  <div key={r._id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-input px-3 py-2">
                                    <div>
                                      <p className="text-xs font-medium text-content">{r.name}</p>
                                      <p className="text-[10px] text-content-muted">
                                        ₹{r.price} · {r.startTime} - {r.endTime} · {r.daysOfWeek?.length || 7} days
                                      </p>
                                    </div>
                                    <button
                                      onClick={() => {
                                        if (window.confirm(`Delete pricing rule "${r.name}"?`)) {
                                          deletePriceRuleMutation.mutate({ menuId: menu._id, itemId: item._id, ruleId: r._id });
                                        }
                                      }}
                                      className="text-accent-red hover:text-accent-red/70"
                                      title="Delete price rule"
                                    >
                                      <FiXCircle size={13} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Scheduled times display */}
                      {isItemScheduled(item) && item.schedule && (
                        <p className="text-[10px] text-content-muted mt-1.5 flex items-center gap-1">
                          <FiClock size={10} />
                          Available {item.schedule.startTime} - {item.schedule.endTime} on{" "}
                          {item.schedule.daysOfWeek?.length === 7
                            ? "All days"
                            : `[${item.schedule.daysOfWeek.join(", ")}]`}
                        </p>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="px-5 py-6 text-center text-content-muted text-sm">
                  No dishes in this category.
                </div>
              )}
            </div>
          </div>
        ))
      )}

      {/* Feature Modal */}
      {featureModal && (
        <MenuFeatureModal
          type={featureModal.type}
          menu={featureModal.menu}
          item={featureModal.item}
          onClose={() => setFeatureModal(null)}
        />
      )}

      {/* Publish Modal */}
      {publishModalMenu && (
        <MenuPublishModal
          menu={publishModalMenu}
          onClose={() => setPublishModalMenu(null)}
        />
      )}

      {/* Structured Text (Notepad) Import Modal */}
      {showTextImport && (
        <MenuTextImportModal onClose={() => setShowTextImport(false)} />
      )}

      {categoryToDelete && (
        <DeleteCategoryModal
          category={categoryToDelete}
          submitting={deleteCategoryMutation.isPending}
          onClose={() => setCategoryToDelete(null)}
          onConfirm={() => deleteCategoryMutation.mutate(categoryToDelete._id)}
        />
      )}
    </div>

  );
};

export default ManageMenu;