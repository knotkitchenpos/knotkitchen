import React, { useMemo, useState } from "react";
import { normalizeRoute, routeSummary, unassignedItems } from "../../utils/kotRouting";

/**
 * Settings > Device Configuration > Kitchen Printers: what one kitchen
 * printer prints. Everything, or chosen categories: choosing a category
 * selects all of its dishes, and each dish can then be switched off for this
 * printer. A dish may print on several printers.
 */

const Chevron = ({ open }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform ${open ? "rotate-90" : ""}`}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

const MiniSwitch = ({ checked, onChange, label, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative w-10 h-6 rounded-full shrink-0 transition-colors disabled:opacity-40 ${checked ? "bg-[#FD5302]" : "bg-[#CBD5E1]"}`}
  >
    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
  </button>
);

/** One line saying what a printer prints, for its card and the overview. */
export const RouteChips = ({ route, menus }) => {
  const s = routeSummary(route, menus);
  if (s.all) return <span className="inline-flex text-[11.5px] font-bold px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#15803D]">Everything</span>;
  if (!s.categories.length) return <span className="inline-flex text-[11.5px] font-bold px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#B45309]">Nothing chosen yet</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {s.categories.map((c) => (
        <span
          key={c.id}
          className={`text-[11.5px] font-bold px-2 py-0.5 rounded-full ${c.on === c.total ? "bg-[#FFF1E8] text-[#C2410C]" : "bg-[#FEF3C7] text-[#92400E]"}`}
          title={`${c.on} of ${c.total} products of ${c.name} print here`}
        >
          {c.name} {c.on === c.total ? "· all" : `· ${c.on}/${c.total}`}
        </span>
      ))}
    </span>
  );
};

export const KotRoutingPanel = ({ printer, menus, onChange, loading }) => {
  const route = normalizeRoute(printer.route);
  const [open, setOpen] = useState({});
  const [q, setQ] = useState("");

  const setRoute = (next) => onChange({ route: normalizeRoute(next) });
  const toggleCategory = (m, on) => {
    const itemIds = (m.items || []).map((i) => String(i?._id));
    // On: every dish of it, as the owner expects; off: forget its switched-off dishes too.
    setRoute({
      all: false,
      categories: on ? [...route.categories, String(m._id)] : route.categories.filter((c) => c !== String(m._id)),
      excluded: route.excluded.filter((x) => !itemIds.includes(x)),
    });
    if (on) setOpen((o) => ({ ...o, [m._id]: true }));
  };
  const toggleItem = (id, on) =>
    setRoute({ ...route, excluded: on ? route.excluded.filter((x) => x !== String(id)) : [...route.excluded, String(id)] });
  const setAllItems = (m, on) => {
    const itemIds = (m.items || []).map((i) => String(i?._id));
    setRoute({ ...route, excluded: on ? route.excluded.filter((x) => !itemIds.includes(x)) : [...new Set([...route.excluded, ...itemIds])] });
  };

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return menus;
    return menus
      .map((m) => (m.name?.toLowerCase().includes(s) ? m : { ...m, items: (m.items || []).filter((i) => i?.name?.toLowerCase().includes(s)), _filtered: true }))
      .filter((m) => !m._filtered || m.items.length);
  }, [menus, q]);

  return (
    <div className="mt-5 pt-4 border-t border-[#E2E8F0]">
      <label className="block max-w-[360px]">
        <span className="text-[13px] font-bold text-[#0F172A]">Printer name</span>
        <input
          value={printer.label || ""}
          maxLength={40}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="e.g. Pizza oven, Bar, Tandoor"
          className="mt-1.5 h-[40px] w-full rounded-xl border border-[#E2E8F0] px-3 text-[14px] font-bold"
        />
        <span className="block text-[11.5px] text-[#94A3B8] mt-1">Printed on top of its tickets when the kitchen has more than one printer.</span>
      </label>

      <p className="mt-4 text-[13px] font-bold text-[#0F172A]">What prints here</p>
      <div className="mt-2 grid grid-cols-2 gap-2 max-w-[420px]" role="radiogroup" aria-label={`What ${printer.label} prints`}>
        {[
          { all: true, title: "Everything", sub: "Every product on the menu" },
          { all: false, title: "Chosen categories", sub: "Only what you pick below" },
        ].map((o) => (
          <button
            key={String(o.all)}
            type="button"
            role="radio"
            aria-checked={route.all === o.all}
            onClick={() => setRoute(o.all ? { all: true } : { ...route, all: false })}
            className={`min-h-[56px] rounded-xl border text-left px-3 py-2 ${
              route.all === o.all ? "border-[#FD5302] bg-[#FFF6F0] ring-1 ring-[#FD5302]" : "border-[#E2E8F0] bg-white"
            }`}
          >
            <span className="block text-[13.5px] font-extrabold text-[#0F172A]">{o.title}</span>
            <span className="block text-[11.5px] text-[#64748B]">{o.sub}</span>
          </button>
        ))}
      </div>

      {!route.all && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <RouteChips route={route} menus={menus} />
          </div>
          <div className="mt-3 rounded-xl border border-[#E2E8F0] overflow-hidden">
            <div className="p-2 border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search category or product…"
                aria-label="Search categories and products"
                className="w-full h-9 px-3 rounded-lg border border-[#E2E8F0] bg-white text-[13px]"
              />
            </div>
            <div className="max-h-[420px] overflow-y-auto divide-y divide-[#E2E8F0]">
              {loading ? (
                <p className="p-4 text-center text-[12.5px] text-[#94A3B8]">Loading menu…</p>
              ) : shown.length === 0 ? (
                <p className="p-4 text-center text-[12.5px] text-[#94A3B8]">{menus.length ? "Nothing matches." : "No published menu on this device yet."}</p>
              ) : (
                shown.map((m) => {
                  const id = String(m._id);
                  const on = route.categories.includes(id);
                  const items = (m.items || []).filter(Boolean);
                  const total = (menus.find((x) => String(x._id) === id)?.items || []).filter(Boolean).length;
                  const count = on ? (menus.find((x) => String(x._id) === id)?.items || []).filter((i) => i && !route.excluded.includes(String(i._id))).length : 0;
                  const expanded = open[id] || Boolean(q.trim());
                  return (
                    <div key={id}>
                      <div className={`flex items-center gap-2 px-3 min-h-[52px] ${on ? "bg-[#FFFBF8]" : "bg-white"}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => toggleCategory(m, e.target.checked)}
                          aria-label={`Print ${m.name} here`}
                          className="w-[18px] h-[18px] accent-[#FD5302] shrink-0"
                        />
                        <button
                          type="button"
                          onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}
                          className="min-w-0 flex-1 flex items-center gap-2 text-left py-2"
                          aria-expanded={expanded}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13.5px] font-extrabold text-[#0F172A] truncate">{m.name}</span>
                            <span className={`block text-[11.5px] ${on ? (count === total ? "text-[#15803D]" : "text-[#B45309]") : "text-[#94A3B8]"}`}>
                              {on ? (count === total ? (total === 1 ? "Its 1 product" : `All ${total} products`) : `${count} of ${total} products`) : `${total} product${total === 1 ? "" : "s"} · not printed here`}
                            </span>
                          </span>
                          <span className="text-[#94A3B8] shrink-0">
                            <Chevron open={expanded} />
                          </span>
                        </button>
                      </div>
                      {expanded && (
                        <div className="bg-[#F8FAFC] border-t border-[#F1F5F9]">
                          {on && items.length > 1 && (
                            <div className="flex justify-end gap-3 px-3 pt-2 text-[11.5px] font-bold">
                              <button type="button" className="text-[#C2410C] hover:underline" onClick={() => setAllItems(m, true)}>All on</button>
                              <button type="button" className="text-[#64748B] hover:underline" onClick={() => setAllItems(m, false)}>All off</button>
                            </div>
                          )}
                          {items.length === 0 ? (
                            <p className="px-3 py-2 text-[12px] text-[#94A3B8]">No products in this category.</p>
                          ) : (
                            items.map((i) => {
                              const itemOn = on && !route.excluded.includes(String(i._id));
                              return (
                                <div key={i._id} className="flex items-center gap-3 pl-9 pr-3 min-h-[44px]">
                                  <span className={`min-w-0 flex-1 text-[13px] font-semibold truncate ${itemOn ? "text-[#0F172A]" : "text-[#94A3B8] line-through decoration-[#CBD5E1]"}`}>
                                    {i.name}
                                  </span>
                                  <MiniSwitch
                                    checked={itemOn}
                                    disabled={!on}
                                    onChange={(v) => toggleItem(i._id, v)}
                                    label={`Print ${i.name} on ${printer.label}`}
                                  />
                                </div>
                              );
                            })
                          )}
                          {!on && items.length > 0 && (
                            <p className="pl-9 pr-3 pb-2 text-[11.5px] text-[#94A3B8]">Tick the category to print its products here.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** Above the kitchen printers: who prints what, and what no printer takes. */
export const KotRoutingOverview = ({ kitchens, menus, hasReceipt }) => {
  const [showMissing, setShowMissing] = useState(false);
  const missing = useMemo(() => unassignedItems(kitchens, menus), [kitchens, menus]);
  if (kitchens.length < 1) return null;
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5">
      <h4 className="text-[15px] font-extrabold text-[#0F172A]">Kitchen printer routing</h4>
      <p className="text-[12px] text-[#64748B] mt-0.5">Each order&apos;s KOT is split: every printer gets only the products assigned to it.</p>
      <ul className="mt-3 space-y-2">
        {kitchens.map((k) => (
          <li key={k.id} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
            <span className="text-[13px] font-extrabold text-[#0F172A] sm:w-[180px] shrink-0 truncate">
              {k.label}
              {!k.type && <span className="ml-1.5 text-[11px] font-bold text-[#B45309]">(not connected)</span>}
            </span>
            <RouteChips route={k.route} menus={menus} />
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <div className="mt-3 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px] font-bold text-[#92400E]">
              {missing.length} product{missing.length === 1 ? "" : "s"} not assigned to any kitchen printer: {missing.length === 1 ? "it is" : "they are"} not printed on the KOT.
            </p>
            <button type="button" onClick={() => setShowMissing((v) => !v)} className="text-[12px] font-bold text-[#B45309] hover:underline">
              {showMissing ? "Hide" : "Show"}
            </button>
          </div>
          {showMissing && (
            <p className="mt-2 text-[12px] text-[#92400E] leading-relaxed">
              {missing.slice(0, 60).map((i) => `${i.name} (${i.categoryName})`).join(", ")}
              {missing.length > 60 ? `, and ${missing.length - 60} more` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
