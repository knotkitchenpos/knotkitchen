import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import ProductPanel from "../components/pos/ProductPanel";
import OrderPanel from "../components/pos/OrderPanel";
import AddCategoryModal from "../components/pos/AddCategoryModal";
import AddProductModal from "../components/pos/AddProductModal";
import { addCategory, addDish, getMenus } from "../https";

/**
 * POS Products screen — main ordering surface.
 *
 *   [ Sidebar (compact) ]  [ ProductPanel (flex-1) ]  [ OrderPanel (380px) ]
 *
 * MODULE 1 redesign contract (see ProductPanel.jsx for card-level rules):
 *   - No "Products" H1. Only the toolbar (search + Add Category + Add Product
 *     + view toggle) is visible above the products grid.
 *   - No menu-management controls on the ordering page: no category delete,
 *     no cross buttons, no "Import Menu". Those live in the Dashboard /
 *     Settings → Manage Menu screens so the counter operator can't
 *     accidentally destroy the menu mid-service.
 *   - Category creation and product creation still open here — those are the
 *     only two menu-management actions the operator needs during service.
 */
const Menu = () => {
  useEffect(() => {
    document.title = "KnotKitchen | Products";
  }, []);

  const queryClient = useQueryClient();
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);

  const { data: menusRes } = useQuery({ queryKey: ["menus"], queryFn: getMenus });
  const menus = menusRes?.data?.data || [];

  const addCategoryMutation = useMutation({
    mutationFn: addCategory,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Category added!", { variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["menus"] });
      setShowAddCategory(false);
    },
    onError: (e) =>
      enqueueSnackbar(e.response?.data?.message || "Failed to add category.", { variant: "error" }),
  });

  const addProductMutation = useMutation({
    mutationFn: addDish,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Product added!", { variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["menus"] });
      queryClient.invalidateQueries({ queryKey: ["popular-items"] });
      setShowAddProduct(false);
    },
    onError: (e) =>
      enqueueSnackbar(e.response?.data?.message || "Failed to add product.", { variant: "error" }),
  });

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Middle: Products */}
      <ProductPanel
        onAddCategory={() => setShowAddCategory(true)}
        onAddProduct={() => setShowAddProduct(true)}
      />

      {/* Right: Order cart */}
      <OrderPanel />

      {showAddCategory && (
        <AddCategoryModal
          submitting={addCategoryMutation.isPending}
          onClose={() => setShowAddCategory(false)}
          onSubmit={(name) => addCategoryMutation.mutate({ name })}
        />
      )}

      {showAddProduct && (
        <AddProductModal
          menus={menus}
          submitting={addProductMutation.isPending}
          onClose={() => setShowAddProduct(false)}
          onSubmit={(payload) => addProductMutation.mutate(payload)}
        />
      )}
    </div>
  );
};

export default Menu;
