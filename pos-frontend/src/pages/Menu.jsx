import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import ProductPanel from "../components/pos/ProductPanel";
import OrderPanel from "../components/pos/OrderPanel";
import AddCategoryModal from "../components/pos/AddCategoryModal";
import AddProductModal from "../components/pos/AddProductModal";
import DeleteCategoryModal from "../components/pos/DeleteCategoryModal";
import { addCategory, addDish, deleteCategory, getMenus } from "../https";

/**
 * Products screen — exact reference layout.
 *
 *   [ Sidebar ]  [ Products panel (flex-1) ]  [ Order panel (fixed 380px) ]
 */
const Menu = () => {
  useEffect(() => {
    document.title = "KnotKitchen | Products";
  }, []);

  const queryClient = useQueryClient();
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState(null);

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

  const deleteCategoryMutation = useMutation({
    mutationFn: deleteCategory,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Category deleted!", { variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["menus"] });
      queryClient.invalidateQueries({ queryKey: ["popular-items"] });
      setCategoryToDelete(null);
    },
    onError: (e) =>
      enqueueSnackbar(e.response?.data?.message || "Failed to delete category.", { variant: "error" }),
  });

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Middle: Products */}
      <ProductPanel
        onAddCategory={() => setShowAddCategory(true)}
        onAddProduct={() => setShowAddProduct(true)}
        onDeleteCategory={(category) => setCategoryToDelete(category)}
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

export default Menu;
