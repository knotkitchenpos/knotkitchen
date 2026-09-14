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

/** The five designs from the Templates folder. Keys match LANDING_TEMPLATES. */
const LANDING_TEMPLATE_INFO = {
  peddler: { name: "Classic", hint: "Dark green hero, sun disc behind a tilted photo, bold serif." },
  citrus: { name: "Citrus", hint: "Warm cream, rounded cards, big photo on the right." },
  night: { name: "Night Market", hint: "Dark and premium, gold accents. Suits late-night and bars." },
  garden: { name: "Garden", hint: "Fresh greens, photo on the left. Suits healthy and cafés." },
  sunset: { name: "Sunset", hint: "Warm peach and terracotta, playful serif." },
};

/** A small colour sketch of each design: page, hero photo block, accent. */
const TemplateThumb = ({ variant }) => {
  const palette = {
    peddler: { bg: "#f4f0e7", hero: "#17251d", accent: "#e85d2a", pop: "#f6c84b", text: "#fbf9f2", photoLeft: false },
    citrus: { bg: "#f7f0e7", hero: "#f7f0e7", accent: "#ea5c2f", pop: "#f4b841", text: "#1f2b20", photoLeft: false },
    night: { bg: "#120d17", hero: "#120d17", accent: "#ff7a59", pop: "#f3c76a", text: "#f8f2e8", photoLeft: false },
    garden: { bg: "#edf5eb", hero: "#edf5eb", accent: "#4d8f57", pop: "#d4a554", text: "#1d2f21", photoLeft: true },
    sunset: { bg: "#fff3ea", hero: "#fff3ea", accent: "#c95736", pop: "#f4ad4a", text: "#2f1d18", photoLeft: false },
  }[variant];
  if (!palette) return null;
  const photoX = palette.photoLeft ? 8 : 64;
  const textX = palette.photoLeft ? 62 : 8;
  return (
    <svg viewBox="0 0 120 80" className="w-full rounded-lg border border-[#E2E8F0]" aria-hidden="true">
      <rect width="120" height="80" fill={palette.bg} />
      <rect width="120" height="52" fill={palette.hero} />
      <rect x="0" y="0" width="120" height="7" fill={palette.hero} />
      <rect x="6" y="2.5" width="22" height="2.5" rx="1" fill={palette.text} opacity="0.85" />
      <rect x="98" y="2" width="16" height="3.5" rx="1.75" fill={palette.accent} />
      {variant === "peddler" ? <circle cx="92" cy="26" r="17" fill={palette.pop} /> : null}
      <rect x={photoX} y="12" width="48" height="36" rx={variant === "peddler" ? 0 : 5} fill={palette.accent} opacity="0.35" />
      <rect x={textX} y="16" width="42" height="6" rx="1" fill={palette.text} />
      <rect x={textX} y="25" width="30" height="6" rx="1" fill={palette.pop} />
      <rect x={textX} y="36" width="18" height="5" rx="2.5" fill={palette.accent} />
      <rect x="8" y="58" width="44" height="16" rx="3" fill={palette.accent} opacity="0.25" />
      <rect x="56" y="58" width="26" height="16" rx="3" fill={palette.accent} opacity="0.18" />
      <rect x="86" y="58" width="26" height="16" rx="3" fill={palette.accent} opacity="0.18" />
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
        displayName: settings.displayName,
        contact: settings.contact,
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
                The first screen a customer sees. The menu is one tap behind it. Every text box can be left empty to
                use the chosen design&apos;s own wording; the restaurant&apos;s name, details and photos are always its own.
              </p>

              <Field label="Design">
                <div className="grid gap-2 sm:grid-cols-3">
                  {(options?.landingTemplates || []).map((key) => {
                    const info = LANDING_TEMPLATE_INFO[key] || { name: key, hint: "" };
                    const active = (settings.landing?.template || "peddler") === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => patch("landing.template", key)}
                        className={`rounded-xl border p-3 text-left transition-colors ${
                          active ? "border-[#FD5302] bg-[#FD5302]/5" : "border-[#E2E8F0] bg-white hover:border-[#CBD5E1]"
                        }`}
                      >
                        <TemplateThumb variant={key} />
                        <span className="mt-2.5 block text-sm font-bold text-[#0F172A]">{info.name}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-[#94A3B8]">{info.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </Field>

              <SectionRule title="Restaurant name & details" hint="Shown in the header, the visit section and the footer." />
              <Field label="Restaurant name">
                <input
                  className={inputClass}
                  maxLength={160}
                  value={settings.displayName || ""}
                  onChange={(e) => patch("displayName", e.target.value)}
                />
              </Field>
              <ImagePicker
                label="Logo (optional, shown beside the name)"
                value={settings.branding?.logo}
                onPick={(v) => patch("branding.logo", v)}
              />
              <div className="grid gap-x-4 sm:grid-cols-2">
                {[
                  ["phone", "Phone", 30],
                  ["email", "Email", 160],
                  ["addressLine1", "Address line 1", 200],
                  ["addressLine2", "Address line 2", 200],
                  ["city", "City", 100],
                  ["postalCode", "PIN code", 20],
                ].map(([key, label, max]) => (
                  <Field key={key} label={label}>
                    <input
                      className={inputClass}
                      maxLength={max}
                      value={settings.contact?.[key] || ""}
                      onChange={(e) => patch(`contact.${key}`, e.target.value)}
                    />
                  </Field>
                ))}
              </div>

              <SectionRule title="Photos" />
              <ImagePicker
                label="Hero photo"
                value={settings.landing?.backgroundImage}
                onPick={(v) => patch("landing.backgroundImage", v)}
              />
              <p className="-mt-2 mb-4 text-xs text-[#94A3B8]">
                Leave empty to use the first featured dish&apos;s photo. Dish cards use each dish&apos;s own photo from the menu.
              </p>

              <SectionRule title="Hero" />
              <Field label="Small line above the headline">
                <input
                  className={inputClass}
                  maxLength={60}
                  placeholder="e.g. Kolkata's sandwich hotline Leave empty for the design's own wording."
                  value={settings.landing?.copy?.kicker || ""}
                  onChange={(e) => patch("landing.copy.kicker", e.target.value)}
                />
              </Field>
              <Field label="Headline">
                <input
                  className={inputClass}
                  maxLength={80}
                  placeholder="e.g. Big flavour. Leave empty for the design's own wording."
                  value={settings.landing?.copy?.headline || ""}
                  onChange={(e) => patch("landing.copy.headline", e.target.value)}
                />
              </Field>
              <Field label="Headline second line (in italics)">
                <input
                  className={inputClass}
                  maxLength={80}
                  placeholder="e.g. Handheld. Leave empty for the design's own wording."
                  value={settings.landing?.copy?.headlineAccent || ""}
                  onChange={(e) => patch("landing.copy.headlineAccent", e.target.value)}
                />
              </Field>
              <Field label="Intro sentence">
                <textarea
                  className={inputClass} rows={2}
                  maxLength={300}
                  placeholder="One or two sentences under the headline. Leave empty for the design's own wording."
                  value={settings.landing?.copy?.lead || ""}
                  onChange={(e) => patch("landing.copy.lead", e.target.value)}
                />
              </Field>
              <Field label="Main button">
                <input
                  className={inputClass}
                  maxLength={40}
                  placeholder="e.g. Browse menu Leave empty for the design's own wording."
                  value={settings.landing?.copy?.ctaText || ""}
                  onChange={(e) => patch("landing.copy.ctaText", e.target.value)}
                />
              </Field>
              <Field label="Badge on the photo">
                <input
                  className={inputClass}
                  maxLength={30}
                  placeholder="e.g. 100% fresh Leave empty for the design's own wording."
                  value={settings.landing?.copy?.heroBadge || ""}
                  onChange={(e) => patch("landing.copy.heroBadge", e.target.value)}
                />
              </Field>
              <Field label="Handwritten note (Classic design only)">
                <input
                  className={inputClass}
                  maxLength={40}
                  placeholder="e.g. made fresh for you Leave empty for the design's own wording."
                  value={settings.landing?.copy?.heroNote || ""}
                  onChange={(e) => patch("landing.copy.heroNote", e.target.value)}
                />
              </Field>

              <SectionRule title="Story section" />
              <Field label="Story heading">
                <input
                  className={inputClass}
                  maxLength={80}
                  placeholder="e.g. Not just a meal. Leave empty for the design's own wording."
                  value={settings.landing?.copy?.storyTitle || ""}
                  onChange={(e) => patch("landing.copy.storyTitle", e.target.value)}
                />
              </Field>
              <Field label="Story heading second line (in italics)">
                <input
                  className={inputClass}
                  maxLength={80}
                  placeholder="e.g. A little daily ritual. Leave empty for the design's own wording."
                  value={settings.landing?.copy?.storyAccent || ""}
                  onChange={(e) => patch("landing.copy.storyAccent", e.target.value)}
                />
              </Field>

              <SectionRule title="Favourites section" />
              <Field label="Favourites heading">
                <input
                  className={inputClass}
                  maxLength={80}
                  placeholder="e.g. Favourites, Leave empty for the design's own wording."
                  value={settings.landing?.copy?.menuTitle || ""}
                  onChange={(e) => patch("landing.copy.menuTitle", e.target.value)}
                />
              </Field>
              <Field label="Favourites heading second part (in italics)">
                <input
                  className={inputClass}
                  maxLength={80}
                  placeholder="e.g. right this way. Leave empty for the design's own wording."
                  value={settings.landing?.copy?.menuAccent || ""}
                  onChange={(e) => patch("landing.copy.menuAccent", e.target.value)}
                />
              </Field>

              <SectionRule title="Order and visit sections" />
              <Field label="Order band heading">
                <input
                  className={inputClass}
                  maxLength={80}
                  placeholder="e.g. Hungry already? Leave empty for the design's own wording."
                  value={settings.landing?.copy?.ctaTitle || ""}
                  onChange={(e) => patch("landing.copy.ctaTitle", e.target.value)}
                />
              </Field>
              <Field label="Order band sentence (Classic design only)">
                <input
                  className={inputClass}
                  maxLength={160}
                  placeholder="e.g. Our online menu is live and ready when you are. Leave empty for the design's own wording."
                  value={settings.landing?.copy?.ctaLead || ""}
                  onChange={(e) => patch("landing.copy.ctaLead", e.target.value)}
                />
              </Field>
              <Field label="Visit heading">
                <input
                  className={inputClass}
                  maxLength={80}
                  placeholder="e.g. Come by, or call ahead. Leave empty for the design's own wording."
                  value={settings.landing?.copy?.visitTitle || ""}
                  onChange={(e) => patch("landing.copy.visitTitle", e.target.value)}
                />
              </Field>
              <Field label="Opening note (press Enter for a new line)">
                <textarea
                  className={inputClass} rows={2}
                  maxLength={120}
                  placeholder="e.g. Freshly prepared, delivered to you. Leave empty for the design's own wording."
                  value={settings.landing?.copy?.hoursText || ""}
                  onChange={(e) => patch("landing.copy.hoursText", e.target.value)}
                />
              </Field>
              <Field label="Footer line">
                <input
                  className={inputClass}
                  maxLength={80}
                  placeholder="e.g. Sandwiches, salads & good moods. Leave empty for the design's own wording."
                  value={settings.landing?.copy?.footerTagline || ""}
                  onChange={(e) => patch("landing.copy.footerTagline", e.target.value)}
                />
              </Field>

              <SectionRule title="Story text" />
              <Field label="Story paragraph">
                <textarea
                  className={inputClass}
                  rows={4}
                  maxLength={4000}
                  placeholder="How the place started, what it is known for. Leave empty for the design's own wording."
                  value={settings.landing?.aboutText || ""}
                  onChange={(e) => patch("landing.aboutText", e.target.value)}
                />
              </Field>

              <SectionRule
                title="Three highlights"
                hint="Short points shown as 01 / 02 / 03, e.g. “Made to order”, “Veg & non-veg”, “Delivered fresh”."
              />
              <div className="grid gap-x-4 sm:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Field key={i} label={`Highlight ${i + 1}`}>
                    <input
                      className={inputClass}
                      maxLength={60}
                      value={settings.landing?.features?.[i]?.title || ""}
                      onChange={(e) => {
                        const next = [0, 1, 2].map((n) => ({ ...(settings.landing?.features?.[n] || {}) }));
                        next[i] = { ...next[i], title: e.target.value };
                        patch("landing.features", next);
                      }}
                    />
                  </Field>
                ))}
              </div>

              <SectionRule
                title="Featured dishes"
                hint="Up to three, shown with their photo and price from the menu. Leave empty to use the first dishes that have photos."
              />
              {dishes.length ? (
                <>
                  <input
                    className={`${inputClass} mb-3`}
                    placeholder="Search dishes…"
                    value={dishQuery}
                    onChange={(e) => setDishQuery(e.target.value)}
                  />
                  <div className="mb-2 max-h-64 overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white">
                    {dishes
                      .filter((d) => `${d.name} ${d.category}`.toLowerCase().includes(dishQuery.trim().toLowerCase()))
                      .slice(0, 200)
                      .map((d) => {
                        const chosen = (settings.landing?.featuredItems || []).map(String);
                        const on = chosen.includes(d.id);
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
                                patch("landing.featuredItems", on ? chosen.filter((x) => x !== d.id) : [...chosen, d.id])
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
                  <p className="mb-4 text-xs text-[#94A3B8]">{(settings.landing?.featuredItems || []).length} of 3 chosen.</p>
                </>
              ) : (
                <p className="mb-4 text-xs text-[#94A3B8]">This restaurant&apos;s menu has not loaded, so there is nothing to pick from yet.</p>
              )}
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
