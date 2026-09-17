import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { getCustomerOrders, getCustomers, updateCustomer } from "../../https";
import { orderDisplayId } from "../../utils/orderLabels";

/**
 * Settings > Customers.
 *
 * Everyone who ever gave a phone number at the till, the website or a table:
 * visits, spend, last seen, and the notes and tags staff keep ("no onion",
 * "office lunch orders"). Customers are created by orders, not here.
 */

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const when = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "never");
const inputClass = "h-[40px] w-full rounded-xl border border-[#E2E8F0] bg-white px-3 text-[13px] font-medium text-[#0F172A] outline-none focus:border-[#FD5302]";

const CustomersView = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(null); // customer
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");

  const { data, isLoading } = useQuery({ queryKey: ["customers", search], queryFn: () => getCustomers(search.trim()) });
  const customers = data?.data?.data || [];
  const { data: ordersRes } = useQuery({
    queryKey: ["customers", open?._id, "orders"],
    queryFn: () => getCustomerOrders(open._id),
    enabled: Boolean(open?._id),
  });
  const orders = ordersRes?.data?.data || [];

  const saveMut = useMutation({
    mutationFn: () => updateCustomer(open._id, { notes, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) }),
    onSuccess: (res) => {
      enqueueSnackbar("Saved", { variant: "success" });
      setOpen(res.data?.data || open);
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not save", { variant: "error" }),
  });

  const show = (c) => {
    setOpen(c);
    setNotes(c.notes || "");
    setTags((c.tags || []).join(", "));
  };

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[#64748B] leading-relaxed">
        Everyone who gave a phone number, from the till, the website or a table. Visits and spend update on every order.
        Keep notes and tags here; they show when the same number comes back.
      </p>
      <input className={inputClass} placeholder="Search by name or phone…" value={search} onChange={(e) => setSearch(e.target.value)} />

      <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-center text-[13px] text-[#94A3B8]">Loading…</p>
        ) : customers.length === 0 ? (
          <p className="p-6 text-center text-[13px] text-[#94A3B8]">No customers yet. They appear as orders come in with a phone number.</p>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead className="bg-[#F8FAFC] text-[11px] uppercase tracking-wide text-[#94A3B8]">
              <tr>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-right">Visits</th>
                <th className="px-3 py-2 text-right">Spent</th>
                <th className="px-3 py-2 text-right hidden sm:table-cell">Last visit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {customers.map((c) => (
                <tr key={c._id} className="cursor-pointer hover:bg-[#F8FAFC]" onClick={() => show(c)}>
                  <td className="px-3 py-2">
                    <span className="font-bold text-[#0F172A]">{c.name || "Walk-in"}</span>
                    <span className="block text-[11.5px] text-[#64748B]">
                      {c.phone}
                      {(c.tags || []).length ? ` · ${c.tags.join(", ")}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">{c.visitCount || 0}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">{money(c.totalSpent)}</td>
                  <td className="px-3 py-2 text-right text-[#64748B] hidden sm:table-cell">{when(c.lastVisitAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => setOpen(null)}>
          <div className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[16px] font-extrabold text-[#0F172A]">{open.name || "Walk-in"}</h3>
                <p className="text-[12.5px] text-[#64748B]">
                  {open.phone}
                  {open.email ? ` · ${open.email}` : ""}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(null)} className="text-2xl leading-none text-[#94A3B8] hover:text-[#475569]" aria-label="Close">&times;</button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[["Visits", open.visitCount || 0], ["Spent", money(open.totalSpent)], ["Last", when(open.lastVisitAt)]].map(([l, v]) => (
                <div key={l} className="rounded-xl bg-[#F8FAFC] p-2">
                  <p className="text-[10.5px] font-bold uppercase text-[#94A3B8]">{l}</p>
                  <p className="text-[14px] font-extrabold text-[#0F172A]">{v}</p>
                </div>
              ))}
            </div>
            <label className="mt-4 block">
              <span className="text-[12.5px] font-bold text-[#475569]">Tags (comma separated)</span>
              <input className={`${inputClass} mt-1`} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="regular, office, no-onion" />
            </label>
            <label className="mt-2 block">
              <span className="text-[12.5px] font-bold text-[#475569]">Notes</span>
              <textarea className={`${inputClass} mt-1 min-h-[72px] py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="Allergies, preferences, how they like their tea…" />
            </label>
            <button type="button" disabled={saveMut.isPending} onClick={() => saveMut.mutate()} className="mt-2 h-[40px] rounded-xl bg-[#FD5302] px-4 text-[13px] font-bold text-white hover:bg-[#D64502] disabled:opacity-50">
              {saveMut.isPending ? "Saving…" : "Save"}
            </button>

            <p className="mt-5 text-[12.5px] font-bold text-[#475569]">Recent orders</p>
            {orders.length === 0 ? (
              <p className="mt-1 text-[12.5px] text-[#94A3B8]">None on record.</p>
            ) : (
              <div className="mt-1 divide-y divide-[#F1F5F9] rounded-xl border border-[#E2E8F0]">
                {orders.map((o) => (
                  <div key={o._id} className="flex items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
                    <div className="min-w-0">
                      <span className="font-bold text-[#0F172A]">#{orderDisplayId(o)}</span>
                      <span className="text-[#64748B]"> · {when(o.createdAt)} · {o.orderType}</span>
                      <p className="truncate text-[11.5px] text-[#94A3B8]">{(o.items || []).map((i) => `${i.quantity}× ${i.name}`).join(", ")}</p>
                    </div>
                    <span className="shrink-0 font-bold tabular-nums">{money(o.bills?.totalWithTax || o.bills?.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomersView;
