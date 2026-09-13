import React, { useEffect, useMemo, useState } from "react";
import { FiX, FiExternalLink } from "react-icons/fi";
import { restaurants as api, errorMessage } from "../api";

/**
 * A restaurant's website design and ordering settings.
 *
 * Homepage & Branding, Landing Page, Colors & Fonts, Layout, Ordering Options
 * and Hours were taken out of the POS's Manage Website: KnotKitchen support
 * manages them here, per restaurant. The tabs are the POS editors moved over
 * as they were, so nothing about how a field behaves changed; the server runs
 * the same validation on the same fields.
 *
 * Images are chosen from the restaurant's own library (uploaded in the POS
 * under Manage Website → Website Images), which is also what the server
 * accepts: an image from another store's library is refused.
 *
 * Hours edits Website Timing -- Collection, Delivery and Restaurant (table
 * booking) time -- which is what the website actually enforces.
 */

const TABS = [
  { key: "branding", label: "Homepage & Branding" },
  { key: "landing", label: "Landing Page" },
  { key: "theme", label: "Colors & Fonts" },
  { key: "layout", label: "Layout" },
  { key: "ordering", label: "Ordering Options" },
  { key: "hours", label: "Hours" },
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const HOUR_CHANNELS = [
  { key: "collection", label: "Collection Time", hint: "When customers can place Collection orders on the website." },
  { key: "delivery", label: "Delivery Time", hint: "When customers can place Delivery orders on the website." },
  { key: "table", label: "Restaurant Time", hint: "When customers can book a table on the website." },
];

/**
 * The landing page templates, in the order the customer website ships them.
 *
 * The keys come from the server (`options.landingTemplates`) so the database
 * stays the authority on what is selectable; this map only supplies the
 * human-readable names, and falls back to the raw key for anything it has not
 * been told about yet.
 */
const LANDING_TEMPLATE_INFO = {
  "fine-dining": {
    name: "Fine Dining",
    hint: "Obsidian and gold, high-contrast serif, no rounded corners anywhere. Your signature dishes are set as a printed course list with roman numerals. For a tasting room.",
  },
  "farm-to-table": {
    name: "Farm to Table",
    hint: "Warm charcoal and ember orange, heavy condensed capitals. Names your growers on the page and chalks up today's dishes. For a seasonal kitchen.",
  },
  "omakase": {
    name: "Omakase",
    hint: "The quiet one. Wide margins, a vertical rail down the side, one dish held up beside the headline. For a counter that seats a few and serves one thing.",
  },
  "coastal-brunch": {
    name: "Coastal Brunch",
    hint: "The only light one. Sand and paper, italic serif, soft rounding, your photo framed in the page rather than behind it. For a daytime room.",
  },
  "urban-izakaya": {
    name: "Urban Izakaya",
    hint: "Near black and hot red, heavy condensed capitals, a live service strip along the top. Leads with ordering rather than atmosphere. For a late kitchen.",
  },
};

/**
 * A wireframe of each landing design, drawn at thumbnail size.
 *
 * Two rounds of this feature were reported back as "they all look the same",
 * and both times the reason was that the owner could not see a design without
 * saving it and reloading the public site. A picker that only lists five names
 * cannot answer "how is Heritage different from Artisan?" -- so it draws the
 * answer: where the masthead sits, what shape the hero is, and how the menu is
 * laid out, which is what actually differs between them.
 *
 * These carry each design's actual palette rather than a neutral grey, because
 * four of the five are dark and one is not -- and which of those a restaurant
 * is choosing is the first thing about a template worth knowing.
 */
const TemplateThumb = ({ variant }) => {
  const shapes = {
    // Dark hero, then the signatures as a numbered course list beside a plate.
    "fine-dining": (
      <>
        <rect x="0" y="0" width="120" height="100" fill="#121110" />
        <rect x="0" y="0" width="120" height="7" fill="#0f0e0d" />
        <rect x="6" y="2.5" width="18" height="2" rx="0.5" fill="#c5a059" />
        <rect x="84" y="2.5" width="30" height="2" rx="0.5" fill="#4a453d" />
        <rect x="0" y="7" width="120" height="40" fill="#1b1917" />
        <rect x="26" y="18" width="68" height="5" rx="0.5" fill="#f5f2eb" />
        <rect x="36" y="26" width="48" height="5" rx="0.5" fill="#f5f2eb" />
        <rect x="46" y="37" width="28" height="4" fill="#c5a059" />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x="8" y={56 + i * 12} width="4" height="3" fill="#c5a059" />
            <rect x="16" y={56 + i * 12} width="34" height="3" rx="0.5" fill="#e8e2d6" />
            <rect x="16" y={61 + i * 12} width="44" height="2" rx="0.5" fill="#4a453d" />
            <rect x="62" y={56 + i * 12} width="8" height="3" rx="0.5" fill="#c5a059" />
          </g>
        ))}
        <rect x="78" y="54" width="36" height="42" fill="#211f1e" />
        <rect x="80" y="56" width="32" height="30" fill="#3a3733" />
      </>
    ),

    // Notice strip, words left over a photo, a stat band, three dish cards.
    "farm-to-table": (
      <>
        <rect x="0" y="0" width="120" height="100" fill="#161311" />
        <rect x="0" y="0" width="120" height="5" fill="#0f0d0b" />
        <rect x="5" y="1.7" width="20" height="1.6" rx="0.5" fill="#e2701e" />
        <rect x="0" y="5" width="120" height="36" fill="#2a2018" />
        <rect x="8" y="16" width="14" height="2" rx="0.5" fill="#e2701e" />
        <rect x="8" y="21" width="60" height="6" rx="0.5" fill="#efe9e3" />
        <rect x="8" y="30" width="24" height="5" fill="#e2701e" />
        <rect x="36" y="30" width="24" height="5" fill="none" stroke="#8a8078" strokeWidth="0.6" />
        <rect x="0" y="41" width="120" height="14" fill="#0f0d0b" />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x={10 + i * 38} y="45" width="16" height="4" rx="0.5" fill="#e2701e" />
            <rect x={10 + i * 38} y="51" width="24" height="1.6" rx="0.5" fill="#4a4440" />
          </g>
        ))}
        {[0, 1, 2].map((i) => (
          <g key={`card-${i}`}>
            <rect x={8 + i * 36} y="62" width="32" height="32" fill="#1d1917" />
            <rect x={8 + i * 36} y="62" width="32" height="16" fill="#3b332c" />
            <rect x={11 + i * 36} y="81" width="20" height="2.5" rx="0.5" fill="#efe9e3" />
            <rect x={11 + i * 36} y="87" width="10" height="3" rx="0.5" fill="#e2701e" />
          </g>
        ))}
      </>
    ),

    // Wide margins, a vertical rail, one dish card pinned beside the words.
    "omakase": (
      <>
        <rect x="0" y="0" width="120" height="100" fill="#131314" />
        <rect x="0" y="0" width="120" height="11" fill="#0d0d0e" />
        <rect x="6" y="6" width="18" height="2.4" rx="0.5" fill="#d4ae7c" />
        <rect x="0" y="11" width="120" height="52" fill="#181819" />
        <rect x="10" y="20" width="12" height="2" rx="0.5" fill="#d4ae7c" />
        <rect x="10" y="26" width="52" height="5" rx="0.5" fill="#eae3d8" />
        <rect x="10" y="34" width="38" height="5" rx="0.5" fill="#eae3d8" />
        <rect x="10" y="45" width="24" height="4.5" fill="#d4ae7c" />
        <rect x="10" y="54" width="46" height="6" fill="#0d0d0e" />
        <rect x="82" y="18" width="1" height="34" fill="#d4ae7c" opacity="0.4" />
        <rect x="90" y="16" width="24" height="40" fill="#1c1c1e" />
        <rect x="92" y="18" width="20" height="26" fill="#3a3733" />
        <rect x="92" y="47" width="14" height="2" rx="0.5" fill="#eae3d8" />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x="10" y={70 + i * 10} width="60" height="8" fill="#181819" />
            <rect x="13" y={72.5 + i * 10} width="26" height="2" rx="0.5" fill="#eae3d8" />
            <rect x="62" y={72.5 + i * 10} width="6" height="2" rx="0.5" fill="#d4ae7c" />
          </g>
        ))}
        <rect x="76" y="70" width="38" height="28" fill="#1c1c1e" />
        <rect x="80" y="76" width="24" height="3" rx="0.5" fill="#eae3d8" />
        <rect x="80" y="88" width="30" height="4" fill="#d4ae7c" />
      </>
    ),

    // Light page, hero as a two-column spread, a framed photo, three cards.
    "coastal-brunch": (
      <>
        <rect x="0" y="0" width="120" height="100" fill="#fdf9f2" />
        <rect x="6" y="2.5" width="18" height="2.4" rx="1.2" fill="#2f2a22" />
        <rect x="92" y="2" width="22" height="3.4" rx="1.7" fill="#e07a25" />
        <rect x="8" y="16" width="12" height="2" rx="0.5" fill="#c2610c" />
        <rect x="8" y="22" width="44" height="5" rx="0.5" fill="#2f2a22" />
        <rect x="8" y="30" width="34" height="5" rx="0.5" fill="#2f2a22" />
        <rect x="8" y="41" width="36" height="9" rx="2" fill="#ffffff" stroke="#e6ddcd" strokeWidth="0.6" />
        <rect x="8" y="54" width="24" height="5" rx="2.5" fill="#e07a25" />
        <rect x="62" y="14" width="52" height="38" rx="4" fill="#f0e2cd" />
        <rect x="66" y="46" width="40" height="10" rx="3" fill="#ffffff" stroke="#e6ddcd" strokeWidth="0.6" />
        <rect x="0" y="62" width="120" height="12" fill="#ffffff" />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x={10 + i * 38} y="65.5" width="18" height="2.4" rx="0.5" fill="#2f2a22" />
            <rect x={10 + i * 38} y="70" width="26" height="1.6" rx="0.5" fill="#b9ab94" />
          </g>
        ))}
        {[0, 1, 2].map((i) => (
          <g key={`card-${i}`}>
            <rect x={8 + i * 36} y="80" width="32" height="18" rx="4" fill="#ffffff" stroke="#e6ddcd" strokeWidth="0.6" />
            <rect x={8 + i * 36} y="80" width="32" height="9" rx="4" fill="#f0e2cd" />
            <rect x={11 + i * 36} y="92" width="16" height="2" rx="0.5" fill="#2f2a22" />
          </g>
        ))}
      </>
    ),

    // Status strip, big condensed words, a dish card with a price, red band.
    "urban-izakaya": (
      <>
        <rect x="0" y="0" width="120" height="100" fill="#0c0b0c" />
        <rect x="0" y="0" width="120" height="5" fill="#141213" />
        <circle cx="7" cy="2.5" r="1.2" fill="#ff3b30" />
        <rect x="11" y="1.7" width="22" height="1.6" rx="0.5" fill="#ff3b30" />
        <rect x="6" y="6.5" width="20" height="3" rx="0.5" fill="#f3f0ee" />
        <rect x="94" y="6.2" width="20" height="3.6" fill="#ff3b30" />
        <rect x="0" y="11" width="120" height="44" fill="#1a1517" />
        <rect x="8" y="18" width="14" height="2" rx="0.5" fill="#ff3b30" />
        <rect x="8" y="23" width="54" height="7" rx="0.5" fill="#f3f0ee" />
        <rect x="8" y="32" width="38" height="7" rx="0.5" fill="#f3f0ee" />
        <rect x="8" y="43" width="24" height="5" fill="#ff3b30" />
        <rect x="74" y="16" width="40" height="34" fill="#141213" />
        <rect x="76" y="18" width="36" height="18" fill="#3a2f31" />
        <rect x="78" y="39" width="18" height="3" rx="0.5" fill="#f3f0ee" />
        <rect x="100" y="39" width="10" height="3" rx="0.5" fill="#ff3b30" />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x={8 + i * 36} y="60" width="32" height="24" fill="#141213" />
            <rect x={8 + i * 36} y="60" width="32" height="13" fill="#332b2d" />
            <rect x={11 + i * 36} y="76" width="16" height="2.5" rx="0.5" fill="#f3f0ee" />
            <rect x={31 + i * 36} y="76" width="6" height="2.5" rx="0.5" fill="#ff3b30" />
          </g>
        ))}
        <rect x="8" y="89" width="104" height="8" fill="#ff3b30" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 120 100" role="img" aria-hidden="true"
      className="block h-[92px] w-full rounded-lg border border-[#E2E8F0] bg-white">
      {shapes[variant] || null}
    </svg>
  );
};

const Field = ({ label, hint, children }) => (
  <label className="block mb-4">
    <span className="block text-sm font-bold text-[#475569] mb-1.5">{label}</span>
    {children}
    {hint ? <span className="block text-xs text-[#94A3B8] mt-1">{hint}</span> : null}
  </label>
);

const inputClass =
  "w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#FD5302] focus:ring-2 focus:ring-[#FD5302]/10";

const Toggle = ({ checked, onChange, label, hint }) => (
  <div className="flex items-start justify-between gap-4 py-3 border-b border-[#E2E8F0] last:border-0">
    <div className="min-w-0">
      <p className="text-sm font-bold text-[#334155]">{label}</p>
      {hint ? <p className="text-xs text-[#94A3B8] mt-0.5">{hint}</p> : null}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative block h-6 w-12 min-w-[3rem] shrink-0 cursor-pointer rounded-full transition-colors ${
        checked ? "bg-[#FD5302]" : "bg-[#CBD5E1]"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-6" : "translate-x-0"
        }`}
      />
    </button>
  </div>
);

/** The restaurant's own images, loaded once per dialog and shared by every picker. */
const MediaContext = React.createContext({ media: [], loading: true });

const ImagePicker = ({ label, value, onPick }) => {
  const { media, loading } = React.useContext(MediaContext);
  const [open, setOpen] = useState(false);
  return (
    <Field label={label}>
      <div className="flex items-center gap-3">
        {value?.url ? (
          <img src={value.thumbnailUrl || value.url} alt="" className="w-16 h-16 rounded-xl object-cover border border-[#E2E8F0]" />
        ) : (
          <div className="w-16 h-16 rounded-xl bg-[#F8FAFC] border border-dashed border-[#CBD5E1] flex items-center justify-center text-xl">🖼️</div>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={() => setOpen((v) => !v)}
            className="px-3 py-2 rounded-xl border border-[#E2E8F0] bg-white text-sm font-bold text-[#475569] hover:text-[#C2410C]">
            {value?.url ? "Change" : "Choose Image"}
          </button>
          {value?.url ? (
            <button type="button" onClick={() => onPick(null)} className="px-3 py-2 rounded-xl text-sm text-red-500 hover:bg-red-50">
              Remove
            </button>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className="mt-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-2">
          {loading ? (
            <p className="p-2 text-xs text-[#94A3B8]">Loading images…</p>
          ) : media.length === 0 ? (
            <p className="p-2 text-xs text-[#94A3B8]">
              This restaurant has no images yet. They upload them in the POS under Manage Website → Website Images.
            </p>
          ) : (
            <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
              {media.map((m) => (
                <button key={m._id} type="button"
                  onClick={() => { onPick({ mediaId: m._id, url: m.url, thumbnailUrl: m.thumbnailUrl || m.url }); setOpen(false); }}
                  className={`overflow-hidden rounded-lg border-2 ${value?.mediaId === m._id ? "border-[#FD5302]" : "border-transparent"}`}>
                  <img src={m.thumbnailUrl || m.url} alt={m.altText || ""} className="h-16 w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </Field>
  );
};

const SectionRule = ({ title, hint }) => (
  <div className="mt-8 mb-4 border-t border-[#E2E8F0] pt-5">
    <h3 className="text-sm font-extrabold text-[#0F172A]">{title}</h3>
    {hint ? <p className="mt-1 text-xs text-[#94A3B8]">{hint}</p> : null}
  </div>
);

/**
 * A list of gallery photos.
 *
 * Built from the single ImagePicker rather than a new picker of its own: the
 * media library already knows how to choose one image, and a second selection
 * UI would be a second place for the tenant-scoping rules to be got wrong.
 */
const GalleryPicker = ({ value, onChange }) => {
  const set = (i, v) => {
    const next = [...value];
    if (v) next[i] = v;
    else next.splice(i, 1);
    onChange(next);
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {value.map((img, i) => (
          <ImagePicker
            key={img?.mediaId || img?.url || i}
            label={`Photo ${i + 1}`}
            value={img}
            onPick={(v) => set(i, v)}
          />
        ))}
      </div>
      {value.length < 12 ? (
        <button
          type="button"
          onClick={() => onChange([...value, { url: "" }])}
          className="mb-4 px-3 py-2 rounded-xl border border-dashed border-[#CBD5E1] bg-white text-sm font-bold text-[#475569] hover:border-[#FD5302] hover:text-[#C2410C]"
        >
          + Add photo
        </button>
      ) : (
        <p className="mb-4 text-xs text-[#94A3B8]">Twelve is the maximum.</p>
      )}
    </>
  );
};

const WebsiteDesignDialog = ({ storeId, onClose }) => {
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [media, setMedia] = useState({ media: [], loading: true });
  const [dishes, setDishes] = useState([]);
  const [dishQuery, setDishQuery] = useState("");
  const [tab, setTab] = useState("branding");
  const [hoursChannel, setHoursChannel] = useState("collection");
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let live = true;
    api.website(storeId)
      .then((d) => { if (live) { setData(d); setSettings(d.settings); } })
      .catch((err) => live && setBanner({ type: "error", text: errorMessage(err, "Could not load the website settings.") }));
    api.websiteMedia(storeId)
      .then((rows) => live && setMedia({ media: rows || [], loading: false }))
      .catch(() => live && setMedia({ media: [], loading: false }));
    api.menus(storeId)
      .then((d) => live && setDishes((d?.menus || []).flatMap((m) =>
        (m.items || []).map((it) => ({ id: String(it.id), name: it.name, category: m.name })))))
      .catch(() => live && setDishes([]));
    return () => { live = false; };
  }, [storeId]);

  const options = data?.options || {};
  const canEdit = Boolean(data?.canEdit);
  const mediaValue = useMemo(() => media, [media]);

  const patch = (path, value) => {
    setSettings((prev) => {
      const next = structuredClone(prev);
      const keys = path.split(".");
      let cursor = next;
      for (let i = 0; i < keys.length - 1; i += 1) {
        cursor[keys[i]] = cursor[keys[i]] || {};
        cursor = cursor[keys[i]];
      }
      cursor[keys[keys.length - 1]] = value;
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    setBanner(null);
    try {
      const saved = await api.updateWebsite(storeId, {
        branding: settings.branding,
        sectionTitles: settings.sectionTitles,
        banners: settings.banners,
        landing: settings.landing,
        theme: settings.theme,
        ordering: settings.ordering,
        channelHours: settings.channelHours,
      });
      if (saved?.settings) setSettings(saved.settings);
      setDirty(false);
      setBanner({ type: "success", text: "Saved. The restaurant's website shows the change within a minute." });
    } catch (err) {
      setBanner({ type: "error", text: errorMessage(err, "Could not save.") });
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  };

  // ---- Hours (Website Timing) ----
  const weeklyFor = (channel) => settings?.channelHours?.[channel]?.weekly || [];
  const dayEntry = (channel, day) =>
    weeklyFor(channel).find((w) => Number(w.day) === day) || { day, isOpen: true, openTime: "11:00", closeTime: "22:00" };
  const setDay = (channel, day, changes) => {
    const all = DAY_NAMES.map((_, d) => ({ ...dayEntry(channel, d) }));
    all[day] = { ...all[day], ...changes };
    patch(`channelHours.${channel}.weekly`, all);
  };
  const copyToAllDays = (channel, day) => {
    const src = dayEntry(channel, day);
    patch(`channelHours.${channel}.weekly`, DAY_NAMES.map((_, d) => ({ ...src, day: d })));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true">
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-navy-100 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-navy-900">Website settings</h2>
            <p className="text-xs text-navy-500">
              Store {storeId}
              {data?.storefrontUrl ? (
                <a href={data.storefrontUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 font-semibold text-brand-600">
                  Open website <FiExternalLink size={12} />
                </a>
              ) : null}
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="rounded-lg p-1.5 text-navy-500 hover:bg-navy-50">
            <FiX size={20} />
          </button>
        </div>

        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-navy-100 px-4 py-2.5">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ${
                tab === t.key ? "bg-brand-600 text-white" : "bg-navy-50 text-navy-700 hover:bg-navy-100"
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {banner ? (
          <div className={`mx-5 mt-3 rounded-xl px-3 py-2 text-sm ${banner.type === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
            {banner.text}
          </div>
        ) : null}
        {data && !canEdit ? (
          <div className="mx-5 mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">View only. Only a CSD admin can change these settings.</div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!settings ? (
            <p className="py-10 text-center text-sm text-navy-400">{banner?.type === "error" ? "" : "Loading…"}</p>
          ) : (
            <MediaContext.Provider value={mediaValue}>
            <fieldset disabled={!canEdit} className="min-w-0">

          {/* ---------- BRANDING & HOMEPAGE CUSTOMIZATION (Module 3) ---------- */}
          {tab === "branding" ? (
            <>
              <ImagePicker
                label="Logo"
                value={settings.branding?.logo}
                onPick={(v) => patch("branding.logo", v)}
              />
              <ImagePicker
                label="Cover / Hero Image"
                value={settings.branding?.coverImage}
                onPick={(v) => patch("branding.coverImage", v)}
              />
              <ImagePicker
                label="Favicon"
                value={settings.branding?.favicon}
                onPick={(v) => patch("branding.favicon", v)}
              />
              <Field label="Website Title">
                <input
                  className={inputClass}
                  value={settings.branding?.siteTitle || ""}
                  onChange={(e) => patch("branding.siteTitle", e.target.value)}
                />
              </Field>
              <Field label="Tagline">
                <input
                  className={inputClass}
                  value={settings.branding?.tagline || ""}
                  onChange={(e) => patch("branding.tagline", e.target.value)}
                />
              </Field>
              <Field label="Website Description" hint="Shown in search results and link previews.">
                <textarea
                  rows={2}
                  className={inputClass}
                  value={settings.branding?.siteDescription || ""}
                  onChange={(e) => patch("branding.siteDescription", e.target.value)}
                />
              </Field>
              <Field label="About Text">
                <textarea
                  rows={5}
                  className={inputClass}
                  value={settings.branding?.aboutText || ""}
                  onChange={(e) => patch("branding.aboutText", e.target.value)}
                />
              </Field>

              {/* Editable Section Titles (Module 3 §4) */}
              <div className="mt-6 pt-5 border-t border-[#E2E8F0] space-y-4">
                <h3 className="font-extrabold text-[#0F172A] text-[15px]">Custom Section Titles</h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Hero Title">
                    <input
                      className={inputClass}
                      value={settings.sectionTitles?.heroTitle || ""}
                      onChange={(e) => patch("sectionTitles.heroTitle", e.target.value)}
                    />
                  </Field>
                  <Field label="Hero Subtitle">
                    <input
                      className={inputClass}
                      value={settings.sectionTitles?.heroSubtitle || ""}
                      onChange={(e) => patch("sectionTitles.heroSubtitle", e.target.value)}
                    />
                  </Field>
                  <Field label="Menu Title">
                    <input
                      className={inputClass}
                      value={settings.sectionTitles?.menuTitle || ""}
                      onChange={(e) => patch("sectionTitles.menuTitle", e.target.value)}
                    />
                  </Field>
                  <Field label="About Title">
                    <input
                      className={inputClass}
                      value={settings.sectionTitles?.aboutTitle || ""}
                      onChange={(e) => patch("sectionTitles.aboutTitle", e.target.value)}
                    />
                  </Field>
                </div>
              </div>

              {/* Homepage Slideshow / Banners (Module 3 §3) */}
              <div className="mt-6 pt-5 border-t border-[#E2E8F0] space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-extrabold text-[#0F172A] text-[15px]">Homepage Slideshow & Banners</h3>
                  <button
                    type="button"
                    onClick={() => {
                      const currentBanners = settings.banners || [];
                      patch("banners", [
                        ...currentBanners,
                        { title: `Slide ${currentBanners.length + 1}`, description: "Special promotion details", buttonText: "Order Now", isActive: true },
                      ]);
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-[#FD5302] text-white text-xs font-bold hover:bg-[#D64502]"
                  >
                    + Add Slide / Banner
                  </button>
                </div>

                {(settings.banners || []).map((banner, idx) => (
                  <div key={idx} className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-[#0F172A]">Banner #{idx + 1}: {banner.title}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = (settings.banners || []).filter((_, i) => i !== idx);
                          patch("banners", updated);
                        }}
                        className="text-xs font-bold text-[#DC2626] hover:underline"
                      >
                        Remove Slide
                      </button>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="font-bold text-[#475569]">Banner Title</label>
                        <input
                          className={inputClass}
                          value={banner.title || ""}
                          onChange={(e) => {
                            const updated = [...(settings.banners || [])];
                            updated[idx] = { ...updated[idx], title: e.target.value };
                            patch("banners", updated);
                          }}
                        />
                      </div>
                      <div>
                        <label className="font-bold text-[#475569]">Button Text</label>
                        <input
                          className={inputClass}
                          value={banner.buttonText || "Order Now"}
                          onChange={(e) => {
                            const updated = [...(settings.banners || [])];
                            updated[idx] = { ...updated[idx], buttonText: e.target.value };
                            patch("banners", updated);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {/* ---------- THEME ---------- */}
          {tab === "landing" ? (
            <>
              <p className="mb-5 text-sm text-[#64748B]">
                The first screen a customer sees. Your menu is one tap behind it.
              </p>

              <Field
                label="Template"
                hint="Changes the layout only. Your colours and fonts stay as they are."
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  {(options?.landingTemplates || []).map((key) => {
                    const info = LANDING_TEMPLATE_INFO[key] || { name: key, hint: "" };
                    const active = (settings.landing?.template || "hero-classic") === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => patch("landing.template", key)}
                        className={`rounded-xl border p-3 text-left transition-colors ${
                          active
                            ? "border-[#FD5302] bg-[#FD5302]/5"
                            : "border-[#E2E8F0] bg-white hover:border-[#CBD5E1]"
                        }`}
                      >
                        <TemplateThumb variant={key} />
                        <span className="block text-sm font-bold text-[#0F172A] mt-2.5">{info.name}</span>
                        <span className="block text-xs text-[#94A3B8] mt-0.5 leading-relaxed">{info.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </Field>

              {/* Every text box below falls back to your branding when left
                  empty, so a store that never opens this tab still gets a
                  finished landing page. */}
              {/* ---- The few dishes on the front door -------------------- */}
              <SectionRule
                title="Featured dishes"
                hint="Two or three, no more. A landing page that lists the whole menu is the ordering page without a basket. Leave it empty and your first few dishes with photos are used."
              />
              {dishes.length ? (
                <>
                  <input
                    className={`${inputClass} mb-3`}
                    placeholder="Search your dishes…"
                    value={dishQuery}
                    onChange={(e) => setDishQuery(e.target.value)}
                  />
                  <div className="mb-4 max-h-64 overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white">
                    {dishes
                      .filter((d) =>
                        `${d.name} ${d.category}`.toLowerCase().includes(dishQuery.trim().toLowerCase()),
                      )
                      .slice(0, 200)
                      .map((d) => {
                        const chosen = (settings.landing?.featuredItems || []).map(String);
                        const on = chosen.includes(d.id);
                        // Three is the cap the layouts are built around, so the
                        // fourth box is disabled rather than silently dropped on
                        // save.
                        const full = chosen.length >= 3 && !on;
                        return (
                          <label
                            key={d.id}
                            className={`flex items-center gap-3 border-b border-[#F1F5F9] px-3 py-2.5 last:border-0 ${
                              full ? "opacity-40" : "cursor-pointer hover:bg-[#F8FAFC]"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={full}
                              onChange={() =>
                                patch(
                                  "landing.featuredItems",
                                  on ? chosen.filter((x) => x !== d.id) : [...chosen, d.id],
                                )
                              }
                              className="h-4 w-4 rounded border-[#CBD5E1]"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-bold text-[#0F172A]">{d.name}</span>
                              <span className="block truncate text-xs text-[#94A3B8]">{d.category}</span>
                            </span>
                          </label>
                        );
                      })}
                  </div>
                  <p className="-mt-2 mb-4 text-xs text-[#94A3B8]">
                    {(settings.landing?.featuredItems || []).length} of 3 chosen.
                  </p>
                </>
              ) : (
                <p className="mb-4 text-xs text-[#94A3B8]">
                  Your menu has not loaded, so there is nothing to pick from yet.
                </p>
              )}

              <SectionRule title="Words" hint="What the first screen says." />
              <Field label="Headline" hint="Leave empty to use your website title.">
                <input
                  className={inputClass}
                  maxLength={120}
                  placeholder={settings.branding?.siteTitle || settings.displayName || ""}
                  value={settings.landing?.headline || ""}
                  onChange={(e) => patch("landing.headline", e.target.value)}
                />
              </Field>

              <Field label="Sub-headline" hint="Leave empty to use your tagline.">
                <input
                  className={inputClass}
                  maxLength={300}
                  placeholder={settings.branding?.tagline || ""}
                  value={settings.landing?.subheadline || ""}
                  onChange={(e) => patch("landing.subheadline", e.target.value)}
                />
              </Field>

              <Field label="Button text">
                <input
                  className={inputClass}
                  maxLength={40}
                  placeholder="View Menu"
                  value={settings.landing?.ctaText || ""}
                  onChange={(e) => patch("landing.ctaText", e.target.value)}
                />
              </Field>

              <ImagePicker
                label="Hero photo"
                value={settings.landing?.backgroundImage}
                onPick={(v) => patch("landing.backgroundImage", v)}
              />
              <p className="-mt-2 mb-4 text-xs text-[#94A3B8]">
                Leave this empty to use your cover image.
              </p>

              <Field
                label={`Photo darkening — ${settings.landing?.overlayOpacity ?? 45}%`}
                hint="Raise it until the headline is easy to read over the photo."
              >
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  className="w-full accent-[#FD5302]"
                  value={settings.landing?.overlayOpacity ?? 45}
                  onChange={(e) => patch("landing.overlayOpacity", Number(e.target.value))}
                />
              </Field>

              {/* ---- Selling points -------------------------------------- */}
              <SectionRule
                title="Three reasons to come"
                hint="Short claims in a row under the hero — “Since 1993”, “Wood-fired daily”, “Free delivery over ₹499”. Leave them empty to hide the row."
              />
              {[0, 1, 2].map((i) => {
                const feature = settings.landing?.features?.[i] || {};
                const setFeature = (key, value) => {
                  const next = [0, 1, 2].map((n) => ({ ...(settings.landing?.features?.[n] || {}) }));
                  next[i] = { ...next[i], [key]: value };
                  patch("landing.features", next);
                };
                return (
                  <div key={i} className="mb-4 rounded-xl border border-[#E2E8F0] bg-white p-4">
                    <Field label={`Point ${i + 1}`}>
                      <input
                        className={inputClass}
                        maxLength={60}
                        placeholder="Heading"
                        value={feature.title || ""}
                        onChange={(e) => setFeature("title", e.target.value)}
                      />
                    </Field>
                    <Field label="Description">
                      <textarea
                        className={inputClass}
                        rows={2}
                        maxLength={240}
                        placeholder="One or two sentences."
                        value={feature.text || ""}
                        onChange={(e) => setFeature("text", e.target.value)}
                      />
                    </Field>
                    <ImagePicker
                      label="Photo (optional)"
                      value={feature.image}
                      onPick={(v) => setFeature("image", v)}
                    />
                  </div>
                );
              })}

              {/* ---- Story ----------------------------------------------- */}
              <SectionRule
                title="Your story"
                hint="A paragraph or two about the restaurant, next to a photo. Leave both empty to hide the section."
              />
              <Field label="Story text" hint="Leave empty to use the About text from Homepage & Branding.">
                <textarea
                  className={inputClass}
                  rows={6}
                  maxLength={4000}
                  placeholder={settings.branding?.aboutText || "How the place started, what you are known for…"}
                  value={settings.landing?.aboutText || ""}
                  onChange={(e) => patch("landing.aboutText", e.target.value)}
                />
              </Field>
              <ImagePicker
                label="Story photo"
                value={settings.landing?.aboutImage}
                onPick={(v) => patch("landing.aboutImage", v)}
              />

              {/* ---- Gallery --------------------------------------------- */}
              <SectionRule title="Gallery" hint="Up to twelve photos of the room, the kitchen and the food." />
              <GalleryPicker
                value={settings.landing?.gallery || []}
                onChange={(v) => patch("landing.gallery", v)}
              />

              {/* ---- Sections -------------------------------------------- */}
              <SectionRule title="Sections" hint="What appears below the hero." />
              <div className="mt-2 rounded-xl border border-[#E2E8F0] bg-white px-4">
                <Toggle
                  label="Your story"
                  hint="The paragraph and photo above."
                  checked={settings.landing?.showAbout !== false}
                  onChange={(v) => patch("landing.showAbout", v)}
                />
                <Toggle
                  label="A look at the menu"
                  hint="A few dishes from each category, straight from Manage Menu."
                  checked={settings.landing?.showMenuPreview !== false}
                  onChange={(v) => patch("landing.showMenuPreview", v)}
                />
                <Toggle
                  label="Gallery"
                  hint="The photos above."
                  checked={settings.landing?.showGallery !== false}
                  onChange={(v) => patch("landing.showGallery", v)}
                />
                <Toggle
                  label="Opening hours"
                  hint="Uses the Hours tab."
                  checked={settings.landing?.showHours !== false}
                  onChange={(v) => patch("landing.showHours", v)}
                />
                <Toggle
                  label="Address and phone"
                  hint="Uses the Contact tab."
                  checked={settings.landing?.showContact !== false}
                  onChange={(v) => patch("landing.showContact", v)}
                />
                <Toggle
                  label="Current offers"
                  hint="Your active offers, if you have any."
                  checked={settings.landing?.showOffers !== false}
                  onChange={(v) => patch("landing.showOffers", v)}
                />
              </div>
            </>
          ) : null}

          {tab === "theme" ? (
            <>
              <h3 className="font-bold text-[#0F172A] mb-3">Colors</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
                {Object.entries(settings.theme?.colors || {}).map(([key, value]) => (
                  <label key={key} className="block">
                    <span className="block text-xs font-medium text-[#AEB8CA] mb-1.5 capitalize">
                      {key.replace(/([A-Z])/g, " $1")}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={value}
                        onChange={(e) => patch(`theme.colors.${key}`, e.target.value)}
                        className="w-10 h-10 rounded-lg bg-white border border-[#E2E8F0] cursor-pointer"
                        aria-label={`${key} color`}
                      />
                      <input
                        className={`${inputClass} font-mono text-xs`}
                        value={value}
                        onChange={(e) => patch(`theme.colors.${key}`, e.target.value)}
                      />
                    </div>
                  </label>
                ))}
              </div>

              <h3 className="font-bold text-[#0F172A] mb-3">Typography</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Heading Font">
                  <select
                    className={inputClass}
                    value={settings.theme?.typography?.headingFont}
                    onChange={(e) => patch("theme.typography.headingFont", e.target.value)}
                  >
                    {options.fonts.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Body Font">
                  <select
                    className={inputClass}
                    value={settings.theme?.typography?.bodyFont}
                    onChange={(e) => patch("theme.typography.bodyFont", e.target.value)}
                  >
                    {options.fonts.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </>
          ) : null}

          {/* ---------- LAYOUT ---------- */}
          {tab === "layout" ? (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  ["heroStyle", "Hero Style", options.heroStyles],
                  ["productCardStyle", "Product Card Style", options.productCardStyles],
                  ["categoryNavStyle", "Category Navigation", options.categoryNavStyles],
                  ["productImagePosition", "Product Image Position", options.imagePositions],
                  ["buttonStyle", "Button Style", options.buttonStyles],
                  ["headerStyle", "Header Style", options.headerStyles],
                  ["footerStyle", "Footer Style", options.footerStyles],
                ].map(([key, label, list]) => (
                  <Field key={key} label={label}>
                    <select
                      className={inputClass}
                      value={settings.theme?.layout?.[key]}
                      onChange={(e) => patch(`theme.layout.${key}`, e.target.value)}
                    >
                      {list.map((v) => (
                        <option key={v} value={v} className="capitalize">{v}</option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>

              <h3 className="font-bold text-[#0F172A] mt-6 mb-1">Sections</h3>
              {[
                ["showOffers", "Show Offers"],
                ["showAbout", "Show About"],
                ["showContact", "Show Contact"],
                ["showHours", "Show Opening Hours"],
              ].map(([key, label]) => (
                <Toggle
                  key={key}
                  label={label}
                  checked={Boolean(settings.theme?.sections?.[key])}
                  onChange={(v) => patch(`theme.sections.${key}`, v)}
                />
              ))}
            </>
          ) : null}

          {/* ---------- ORDERING ---------- */}
          {tab === "ordering" ? (
            <>
              <Toggle
                label="Pickup / Collection"
                checked={settings.ordering?.pickupEnabled}
                onChange={(v) => patch("ordering.pickupEnabled", v)}
              />
              <Toggle
                label="Delivery"
                checked={settings.ordering?.deliveryEnabled}
                onChange={(v) => patch("ordering.deliveryEnabled", v)}
              />
              <Toggle
                label="Accept Pre-orders When Closed"
                checked={settings.ordering?.acceptPreOrders}
                onChange={(v) => patch("ordering.acceptPreOrders", v)}
              />
              <Toggle
                label="Allow Special Instructions"
                checked={settings.ordering?.specialInstructionsEnabled}
                onChange={(v) => patch("ordering.specialInstructionsEnabled", v)}
              />

              <div className="grid sm:grid-cols-2 gap-4 mt-5">
                {[
                  ["minOrderValue", "Minimum Order Value"],
                  ["deliveryFee", "Delivery Fee"],
                  ["freeDeliveryAbove", "Free Delivery Above"],
                  ["packagingFee", "Packaging Fee"],
                  ["taxPercent", "Tax %"],
                  ["prepTimeMinutes", "Preparation Time (minutes)"],
                ].map(([key, label]) => (
                  <Field key={key} label={label}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className={inputClass}
                      value={settings.ordering?.[key] ?? 0}
                      onChange={(e) => patch(`ordering.${key}`, Number(e.target.value))}
                    />
                  </Field>
                ))}
                <Field label="Currency Symbol">
                  <input
                    className={inputClass}
                    value={settings.ordering?.currencySymbol || ""}
                    onChange={(e) => patch("ordering.currencySymbol", e.target.value)}
                  />
                </Field>
              </div>

              <Toggle
                label="Prices Include Tax"
                checked={settings.ordering?.taxInclusive}
                onChange={(v) => patch("ordering.taxInclusive", v)}
              />
            </>
          ) : null}

          {tab === "ordering" ? (
            <div className="mt-6 pt-5 border-t border-[#E2E8F0]">
              <p className="text-sm font-bold text-[#0F172A]">Table Booking</p>
              <p className="text-xs text-[#64748B] mb-3">
                Customers request a table from the website; you accept or cancel it on the POS.
              </p>
              <Toggle
                label="Allow Table Booking"
                checked={settings.ordering?.tableBooking?.enabled !== false}
                onChange={(v) => patch("ordering.tableBooking.enabled", v)}
              />
              <div className="grid sm:grid-cols-2 gap-4 mt-4">
                <Field label="Booking From">
                  <input
                    type="time"
                    className={inputClass}
                    value={settings.ordering?.tableBooking?.openTime || "16:00"}
                    onChange={(e) => patch("ordering.tableBooking.openTime", e.target.value)}
                  />
                </Field>
                <Field label="Booking Until">
                  <input
                    type="time"
                    className={inputClass}
                    value={settings.ordering?.tableBooking?.closeTime || "22:00"}
                    onChange={(e) => patch("ordering.tableBooking.closeTime", e.target.value)}
                  />
                </Field>
                {[
                  ["slotMinutes", "Time Slot Every (minutes)", 30],
                  ["holdBeforeMinutes", "Block Table Before Booking (minutes)", 30],
                  ["releaseAfterMinutes", "Release If No-Show After (minutes)", 60],
                ].map(([key, label, fallback]) => (
                  <Field key={key} label={label}>
                    <input
                      type="number"
                      min="0"
                      step="5"
                      className={inputClass}
                      value={settings.ordering?.tableBooking?.[key] ?? fallback}
                      onChange={(e) => patch(`ordering.tableBooking.${key}`, Number(e.target.value))}
                    />
                  </Field>
                ))}
              </div>
            </div>
          ) : null}

        {tab === "hours" ? (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              {HOUR_CHANNELS.map((c) => (
                <button key={c.key} type="button" onClick={() => setHoursChannel(c.key)}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${
                    hoursChannel === c.key ? "border-[#FD5302] bg-[#FFF1E8] text-[#C2410C]" : "border-[#E2E8F0] text-[#475569]"
                  }`}>
                  {c.label}
                </button>
              ))}
            </div>
            <p className="mb-3 text-xs text-[#64748B]">
              {HOUR_CHANNELS.find((c) => c.key === hoursChannel)?.hint} Close for Today and holidays are set by the
              restaurant in the POS under Website Timing &amp; Holidays.
              {weeklyFor(hoursChannel).length === 0 ? " No hours saved yet: this is open all day until you save." : ""}
            </p>
            <div className="divide-y divide-[#E2E8F0] rounded-xl border border-[#E2E8F0]">
              {DAY_NAMES.map((dayName, day) => {
                const entry = dayEntry(hoursChannel, day);
                return (
                  <div key={day} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <span className="w-24 text-sm font-semibold text-[#475569]">{dayName}</span>
                    <label className="flex items-center gap-1.5 text-xs text-[#475569]">
                      <input type="checkbox" checked={Boolean(entry.isOpen)} className="h-4 w-4"
                        onChange={(e) => setDay(hoursChannel, day, { isOpen: e.target.checked })} />
                      Open
                    </label>
                    <input type="time" value={entry.openTime} disabled={!entry.isOpen}
                      onChange={(e) => setDay(hoursChannel, day, { openTime: e.target.value })}
                      className={`${inputClass} w-32 disabled:opacity-40`} />
                    <span className="text-[#94A3B8]">–</span>
                    <input type="time" value={entry.closeTime} disabled={!entry.isOpen}
                      onChange={(e) => setDay(hoursChannel, day, { closeTime: e.target.value })}
                      className={`${inputClass} w-32 disabled:opacity-40`} />
                    <button type="button" onClick={() => copyToAllDays(hoursChannel, day)}
                      className="ml-auto text-xs font-semibold text-[#C2410C] hover:underline">
                      Copy to all days
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
            </fieldset>
            </MediaContext.Provider>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-navy-100 px-5 py-3">
          <button type="button" onClick={close} className="rounded-xl border border-navy-200 px-4 py-2 text-sm font-semibold text-navy-700">
            Close
          </button>
          {canEdit ? (
            <button type="button" onClick={save} disabled={busy || !dirty}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {busy ? "Saving…" : "Save changes"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default WebsiteDesignDialog;
