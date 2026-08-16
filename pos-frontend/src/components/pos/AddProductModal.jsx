import React, { useState } from "react";
import { ModalShell, Field, inputCls } from "./ModalShell";

/** Add a product. Subcategory is optional — leaving it blank keeps the
 *  Category → Products flow, filling it enables Category → Subcategory → Products. */
const AddProductModal = ({ menus = [], submitting, onClose, onSubmit }) => {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [menuId, setMenuId] = useState(menus[0]?._id || "");
  const [subcategory, setSubcategory] = useState("");
  const [err, setErr] = useState({});

  const submit = (e) => {
    e.preventDefault();
    const n = {};
    if (!name.trim()) n.name = "Product name is required";
    if (!price || Number(price) <= 0) n.price = "Enter a valid price";
    if (!menuId) n.menuId = "Select a category";
    setErr(n);
    if (Object.keys(n).length) return;
    const menu = menus.find((m) => m._id === menuId);
    onSubmit({
      name: name.trim(),
      price: Number(price),
      category: menu?.name || menuId,
      menuId,
      subcategory: subcategory.trim(),
    });
  };

  return (
    <ModalShell title="Add Product" subtitle="Products appear on the POS product grid." onClose={onClose} width={500}>
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="Product Name" error={err.name}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Butter Chicken"
            maxLength={140}
            className={inputCls(err.name)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Price (₹)" error={err.price}>
            <input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="e.g. 250"
              className={inputCls(err.price)}
            />
          </Field>

          <Field label="Category" error={err.menuId}>
            <select
              value={menuId}
              onChange={(e) => setMenuId(e.target.value)}
              className={inputCls(err.menuId)}
            >
              <option value="">Select category</option>
              {menus.map((m) => (
                <option key={m._id} value={m._id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Subcategory (optional)">
          <input
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            placeholder="e.g. Beef Burgers"
            maxLength={120}
            className={inputCls(false)}
          />
        </Field>
        <p className="text-[11.5px] text-[#94A3B8] -mt-1">
          Leave blank to show products directly under the category.
        </p>

        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-[48px] rounded-xl border border-[#E2E8F0] text-[#334155] text-[14px] font-bold hover:bg-[#F8FAFC] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || menus.length === 0}
            className="h-[48px] rounded-xl bg-[#5B42F3] text-white text-[14px] font-bold hover:bg-[#4A32E0] disabled:opacity-50"
          >
            {submitting ? "Adding…" : "Add Product"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

export default AddProductModal;
