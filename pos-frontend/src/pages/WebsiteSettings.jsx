import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import MediaLibrary from "../components/media/MediaLibrary";
import SecurityPinModal from "../components/common/SecurityPinModal";
import { isOwner, checkActionAuthorization } from "../utils/security";
import { getWebsiteSettings, updateWebsiteSettings, validateGatewayCredentials } from "../https/storefrontApi";
import { publishWebsiteCache } from "../https";

/**
 * Settings → Website (§3, §19, §26).
 *
 * Every control here maps to a whitelisted field on the backend. There is
 * deliberately no "custom CSS/HTML" input: appearance is configured through
 * predefined safe options only.
 */

const TABS = [
  { key: "general", label: "Domain & General" },
  { key: "branding", label: "Homepage & Branding" },
  { key: "theme", label: "Colors & Fonts" },
  { key: "layout", label: "Layout" },
  { key: "ordering", label: "Ordering Options" },
  { key: "payments", label: "Payment Gateway" },
  { key: "hours", label: "Hours" },
  { key: "contact", label: "Contact" },
  { key: "media", label: "Website Images" },
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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

const ImagePicker = ({ label, value, onPick, folder }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Field label={label}>
        <div className="flex items-center gap-3">
          {value?.url ? (
            <img
              src={value.thumbnailUrl || value.url}
              alt=""
              className="w-16 h-16 rounded-xl object-cover border border-[#E2E8F0]"
            />
          ) : (
            <div className="w-16 h-16 rounded-xl bg-[#F8FAFC] border border-dashed border-[#CBD5E1] flex items-center justify-center text-xl">
              🖼️
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="px-3 py-2 rounded-xl border border-[#E2E8F0] bg-white text-sm font-bold text-[#475569] hover:border-[#C7C2FF] hover:text-[#C2410C]"
            >
              {value?.url ? "Change" : "Choose Image"}
            </button>
            {value?.url ? (
              <button
                type="button"
                onClick={() => onPick(null)}
                className="px-3 py-2 rounded-xl text-sm text-red-400 hover:bg-red-500/10"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </Field>

      {open ? (
        <MediaLibrary
          mode="picker"
          folder={folder}
          onClose={() => setOpen(false)}
          onSelect={(asset) => {
            onPick({ mediaId: asset._id, url: asset.url, thumbnailUrl: asset.thumbnailUrl });
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
};

const WebsiteSettings = () => {
  const user = useSelector((state) => state.user);
  const [settings, setSettings] = useState(null);
  const [options, setOptions] = useState(null);
  const [themes, setThemes] = useState([]);
  const [storefrontUrl, setStorefrontUrl] = useState("");
  const [tab, setTab] = useState("general");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // Edits live in `settings` until an explicit save. Publishing does NOT
  // persist them (see publish() below), so the editor has to know whether
  // anything is pending.
  const [dirty, setDirty] = useState(false);

  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await getWebsiteSettings();
        const { settings: s, options: o, themes: t, storefrontUrl: url } = res.data.data;
        setSettings(s);
        setOptions(o);
        setThemes(t);
        setStorefrontUrl(url);
      } catch (err) {
        setMessage({ type: "error", text: err.response?.data?.message || "Couldn't load settings." });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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

  const executeWithSecurity = (actionFn, isOwnerOnly = false) => {
    const auth = checkActionAuthorization(user, { isOwnerOnly });
    if (auth.status === "DENIED_OWNER_ONLY") {
      setMessage({ type: "error", text: auth.message });
      return;
    }
    if (auth.status === "REQUIRE_PIN") {
      setPendingAction(() => actionFn);
      setPinModalOpen(true);
      return;
    }
    actionFn();
  };

  /** Write the editor's current state to the server. Throws on failure. */
  const persist = async () => {
    const res = await updateWebsiteSettings(settings);
    setSettings(res.data.data.settings);
    setStorefrontUrl(res.data.data.storefrontUrl);
    setDirty(false);
  };

  const save = async () => {
    executeWithSecurity(async () => {
      try {
        setSaving(true);
        setMessage(null);
        await persist();
        setMessage({ type: "success", text: "Website settings saved." });
      } catch (err) {
        setMessage({ type: "error", text: err.response?.data?.message || "Couldn't save settings." });
      } finally {
        setSaving(false);
        setTimeout(() => setMessage(null), 4000);
      }
    });
  };

  /**
   * Publish = refresh the live customer-site cache. It does NOT send the
   * editor's state, so on its own it drops anything unsaved while still
   * reporting success — which is how a freshly picked logo could be uploaded,
   * "published", and silently never stored. Save first, then publish.
   */
  const publish = async () => {
    executeWithSecurity(async () => {
      try {
        setSaving(true);
        setMessage(null);
        if (dirty) await persist();
        const res = await publishWebsiteCache();
        setMessage({
          type: "success",
          text: res.data?.message || "Website published / cache updated!",
        });
      } catch (e) {
        setMessage({
          type: "error",
          text: e.response?.data?.message || "Failed to publish website.",
        });
      } finally {
        setSaving(false);
        setTimeout(() => setMessage(null), 5000);
      }
    });
  };

  if (loading) {
    return (
      <div className="h-full overflow-y-auto bg-[#F8FAFC] p-6">
        <div className="h-8 w-56 rounded bg-[#E2E8F0] animate-pulse mb-6" />
        <div className="h-64 rounded-2xl bg-white animate-pulse" />
      </div>
    );
  }

  if (!settings) {
    return <div className="h-full overflow-y-auto bg-[#F8FAFC] p-6 text-[#64748B]">{message?.text || "Website settings unavailable."}</div>;
  }

  return (
    <div className="h-full min-h-0 w-full overflow-y-auto">
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold text-[#0F172A]">Website</h1>
          <a
            href={storefrontUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-[#C2410C] hover:underline break-all"
          >
            {storefrontUrl}
          </a>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={publish}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-[#22C55E] text-white text-sm font-bold hover:bg-[#16A34A] shadow-sm disabled:opacity-60"
          >
            🚀 Publish Website
          </button>
          <a
            href="/website/preview"
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-xl border border-[#E2E8F0] bg-white text-sm font-bold text-[#475569] hover:border-[#C7C2FF] hover:text-[#C2410C]"
          >
            👁 Preview
          </a>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-5 py-2 rounded-xl bg-[#FD5302] text-white text-sm font-bold disabled:opacity-60 hover:bg-[#D64502]"
          >
            {saving ? "Saving…" : "Save Changes"}
            {dirty && !saving ? (
              <span
                aria-hidden="true"
                title="You have unsaved changes"
                className="ml-2 inline-block w-2 h-2 rounded-full bg-white/90 align-middle"
              />
            ) : null}
          </button>
          {dirty && !saving ? (
            <span className="text-xs font-semibold text-[#B45309]">Unsaved changes</span>
          ) : null}
        </div>
      </div>

      {message ? (
        <p
          role="status"
          className={`mb-4 p-3 rounded-xl text-sm ${
            message.type === "error"
              ? "bg-[#FEF2F2] text-[#DC2626]"
              : "bg-[#ECFDF5] text-[#16A34A]"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto mb-5 border-b border-[#E2E8F0] pb-px">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`shrink-0 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
              tab === t.key
                ? "border-[#FD5302] text-[#C2410C]"
                : "border-transparent text-[#94A3B8] hover:text-[#475569]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-card">
        {/* ---------- GENERAL / DOMAIN ---------- */}
        {tab === "general" ? (
          <>
            <Toggle
              label="Website Enabled"
              hint="Turn off to show a temporary 'unavailable' message to customers."
              checked={settings.enabled}
              onChange={(v) => patch("enabled", v)}
            />

            {/* Custom Domain Section (Module 2) */}
            <div className="mt-5 p-4 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-extrabold text-[15px] text-[#0F172A]">Custom Purchased Domain</h3>
                {settings.customDomain ? (
                  <span className="px-3 py-1 rounded-full bg-[#DCFCE7] text-[#15803D] font-bold text-xs">
                    Connected (Active SSL)
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full bg-[#F1F5F9] text-[#64748B] font-bold text-xs">
                    Not Connected
                  </span>
                )}
              </div>

              <Field
                label="Custom Domain Address"
                hint="Enter your purchased domain (e.g. myrestaurant.com or www.myrestaurant.com)."
              >
                <input
                  className={inputClass}
                  placeholder="e.g. myrestaurant.com"
                  value={settings.customDomain || ""}
                  onChange={(e) => patch("customDomain", e.target.value)}
                />
              </Field>

              {settings.customDomain && (
                <div className="space-y-2 pt-2 border-t border-[#E2E8F0] text-xs">
                  <p className="font-bold text-[#334155]">
                    Clickable Domain:{" "}
                    <a
                      href={`https://${settings.customDomain}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#C2410C] hover:underline font-extrabold"
                    >
                      https://{settings.customDomain}
                    </a>
                  </p>

                  <div className="p-3 bg-white rounded-xl border border-[#E2E8F0] space-y-1">
                    <p className="font-bold text-[#0F172A]">Required DNS Records for Verification:</p>
                    <p className="text-[#64748B] font-mono">CNAME → cname.knotkitchen.online</p>
                    <p className="text-[#64748B] font-mono">TXT → knotkitchen-verify={settings.storeId}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5">
              <Field
                label="Subdomain / Slug Address"
                hint={`Customers will visit /store/${settings.slug}`}
              >
                <input
                  className={inputClass}
                  value={settings.slug}
                  onChange={(e) => patch("slug", e.target.value)}
                />
              </Field>
              <Field label="Restaurant Display Name">
                <input
                  className={inputClass}
                  value={settings.displayName || ""}
                  onChange={(e) => patch("displayName", e.target.value)}
                />
              </Field>
              <Field label="Theme">
                <select
                  className={inputClass}
                  value={settings.theme?.themeKey}
                  onChange={(e) => patch("theme.themeKey", e.target.value)}
                >
                  {themes.map((t) => (
                    <option key={t.key} value={t.key} disabled={t.status !== "available"}>
                      {t.name}
                      {t.status !== "available" ? " (coming soon)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        ) : null}

        {/* ---------- BRANDING & HOMEPAGE CUSTOMIZATION (Module 3) ---------- */}
        {tab === "branding" ? (
          <>
            <ImagePicker
              label="Logo"
              folder="logo"
              value={settings.branding?.logo}
              onPick={(v) => patch("branding.logo", v)}
            />
            <ImagePicker
              label="Cover / Hero Image"
              folder="cover"
              value={settings.branding?.coverImage}
              onPick={(v) => patch("branding.coverImage", v)}
            />
            <ImagePicker
              label="Favicon"
              folder="logo"
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

        {/* ---------- HOURS ---------- */}
        {tab === "hours" ? (
          <>
            <Toggle
              label="Enforce Opening Hours"
              hint="When off, customers can order at any time."
              checked={settings.useBusinessHours}
              onChange={(v) => patch("useBusinessHours", v)}
            />
            <div className="mt-4 space-y-2">
              {DAY_NAMES.map((dayName, day) => {
                const entry =
                  settings.openingHours?.find((h) => h.day === day) || {
                    day,
                    isOpen: false,
                    openTime: "09:00",
                    closeTime: "22:00",
                  };
                const updateDay = (changes) => {
                  const rest = (settings.openingHours || []).filter((h) => h.day !== day);
                  patch(
                    "openingHours",
                    [...rest, { ...entry, ...changes }].sort((a, b) => a.day - b.day)
                  );
                };
                return (
                  <div key={day} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="w-24 text-sm font-semibold text-[#475569]">{dayName}</span>
                    <input
                      type="checkbox"
                      checked={entry.isOpen}
                      onChange={(e) => updateDay({ isOpen: e.target.checked })}
                      className="accent-accent w-4 h-4"
                      aria-label={`${dayName} open`}
                    />
                    <input
                      type="time"
                      value={entry.openTime}
                      disabled={!entry.isOpen}
                      onChange={(e) => updateDay({ openTime: e.target.value })}
                      className={`${inputClass} w-32 disabled:opacity-40`}
                    />
                    <span className="text-[#94A3B8]">–</span>
                    <input
                      type="time"
                      value={entry.closeTime}
                      disabled={!entry.isOpen}
                      onChange={(e) => updateDay({ closeTime: e.target.value })}
                      className={`${inputClass} w-32 disabled:opacity-40`}
                    />
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        {/* ---------- CONTACT ---------- */}
        {tab === "contact" ? (
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              ["phone", "Phone"],
              ["email", "Email"],
              ["addressLine1", "Address Line 1"],
              ["addressLine2", "Address Line 2"],
              ["city", "City"],
              ["postalCode", "Postcode"],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  className={inputClass}
                  value={settings.contact?.[key] || ""}
                  onChange={(e) => patch(`contact.${key}`, e.target.value)}
                />
              </Field>
            ))}
          </div>
        ) : null}

        {/* ---------- PAYMENTS ---------- */}
        {tab === "payments" ? (
          <div className="space-y-6">
            {!isOwner(user) && (
              <div className="p-4 rounded-2xl bg-[#FEF2F2] border border-[#FECACA] text-xs font-bold text-[#DC2626]">
                🔒 Payment Gateway Configuration is restricted to the Store Owner only. Staff members cannot view or edit secrets.
              </div>
            )}
            <div>
              <h3 className="font-bold text-[#0F172A] text-base mb-1">Payment Gateways & Pay by Link</h3>
              <p className="text-xs text-[#94A3B8]">
                Configure Cashfree or PhonePe gateway credentials. Only ONE gateway can be active at a time for website ordering & Pay by Link.
              </p>
            </div>

            {/* Active Gateway Selection */}
            <div className="p-4 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-extrabold text-sm text-[#0F172A]">Active Payment Gateway</h4>
                <span className="px-3 py-1 rounded-full bg-[#FD5302]/10 text-[#C2410C] font-extrabold text-xs uppercase">
                  Current: {settings.paymentGateways?.activeGateway || "cashfree"}
                </span>
              </div>
              <Field label="Select Active Gateway" hint="Pay by Link and storefront payments will use this gateway.">
                <select
                  className={inputClass}
                  value={settings.paymentGateways?.activeGateway || "cashfree"}
                  onChange={(e) => patch("paymentGateways.activeGateway", e.target.value)}
                >
                  <option value="cashfree">Cashfree {settings.paymentGateways?.cashfree?.isConfigured ? "(Configured)" : "(Not Configured)"}</option>
                  <option value="phonepe">PhonePe {settings.paymentGateways?.phonepe?.isConfigured ? "(Configured)" : "(Not Configured)"}</option>
                </select>
              </Field>
            </div>

            {/* Gateway Credentials Management */}
            <div className="space-y-5 pt-2">
              {/* Cashfree Gateway Card */}
              <div className="p-4 rounded-2xl border border-[#E2E8F0] bg-white space-y-3 shadow-xs">
                <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">💰</span>
                    <div>
                      <h4 className="font-extrabold text-sm text-[#0F172A]">Cashfree</h4>
                      <p className="text-xs text-[#94A3B8]">Accept Instant UPI, Cards & BNPL</p>
                    </div>
                  </div>
                  {settings.paymentGateways?.cashfree?.isConfigured ? (
                    <span className="px-2.5 py-1 rounded-full bg-[#DCFCE7] text-[#15803D] text-xs font-bold">Configured</span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full bg-[#F1F5F9] text-[#64748B] text-xs font-bold">Unconfigured</span>
                  )}
                </div>
                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                  <Field label="Client ID (App ID)">
                    <input
                      className={inputClass}
                      placeholder="CF_APP_..."
                      value={settings.paymentGateways?.cashfree?.clientId || ""}
                      onChange={(e) => patch("paymentGateways.cashfree.clientId", e.target.value)}
                    />
                  </Field>
                  <Field label="Client Secret" hint={settings.paymentGateways?.cashfree?.clientSecretMasked ? `Masked: ${settings.paymentGateways.cashfree.clientSecretMasked}` : "Encrypted at rest"}>
                    <input
                      type="password"
                      className={inputClass}
                      placeholder="Enter new secret or leave unchanged"
                      value={settings.paymentGateways?.cashfree?.clientSecret || ""}
                      onChange={(e) => patch("paymentGateways.cashfree.clientSecret", e.target.value)}
                    />
                  </Field>
                  <Field label="Environment">
                    <select
                      className={inputClass}
                      value={settings.paymentGateways?.cashfree?.environment || "TEST"}
                      onChange={(e) => patch("paymentGateways.cashfree.environment", e.target.value)}
                    >
                      <option value="TEST">TEST (Sandbox)</option>
                      <option value="PROD">PROD (Live)</option>
                    </select>
                  </Field>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await validateGatewayCredentials({
                        gateway: "cashfree",
                        clientId: settings.paymentGateways?.cashfree?.clientId,
                        clientSecret: settings.paymentGateways?.cashfree?.clientSecret || "existing_secret_token",
                        environment: settings.paymentGateways?.cashfree?.environment || "TEST",
                      });
                      setMessage({ type: "success", text: res.data?.message || "Cashfree credentials validated!" });
                      save();
                    } catch (err) {
                      setMessage({ type: "error", text: err.response?.data?.message || "Validation failed." });
                    }
                  }}
                  className="px-3.5 py-1.5 rounded-xl border border-[#FD5302] text-[#C2410C] text-xs font-bold hover:bg-[#FD5302]/5"
                >
                  Verify & Save Cashfree Credentials
                </button>
              </div>

              {/* PhonePe Gateway Card */}
              <div className="p-4 rounded-2xl border border-[#E2E8F0] bg-white space-y-3 shadow-xs">
                <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">📱</span>
                    <div>
                      <h4 className="font-extrabold text-sm text-[#0F172A]">PhonePe</h4>
                      <p className="text-xs text-[#94A3B8]">Direct PhonePe UPI & PG Integration</p>
                    </div>
                  </div>
                  {settings.paymentGateways?.phonepe?.isConfigured ? (
                    <span className="px-2.5 py-1 rounded-full bg-[#DCFCE7] text-[#15803D] text-xs font-bold">Configured</span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full bg-[#F1F5F9] text-[#64748B] text-xs font-bold">Unconfigured</span>
                  )}
                </div>
                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                  <Field label="Merchant ID">
                    <input
                      className={inputClass}
                      placeholder="MERCHANTUAT..."
                      value={settings.paymentGateways?.phonepe?.merchantId || ""}
                      onChange={(e) => patch("paymentGateways.phonepe.merchantId", e.target.value)}
                    />
                  </Field>
                  <Field label="Salt Key" hint={settings.paymentGateways?.phonepe?.saltKeyMasked ? `Masked: ${settings.paymentGateways.phonepe.saltKeyMasked}` : "Encrypted at rest"}>
                    <input
                      type="password"
                      className={inputClass}
                      placeholder="Enter new salt key or leave unchanged"
                      value={settings.paymentGateways?.phonepe?.saltKey || ""}
                      onChange={(e) => patch("paymentGateways.phonepe.saltKey", e.target.value)}
                    />
                  </Field>
                  <Field label="Salt Index">
                    <input
                      className={inputClass}
                      placeholder="1"
                      value={settings.paymentGateways?.phonepe?.saltIndex || "1"}
                      onChange={(e) => patch("paymentGateways.phonepe.saltIndex", e.target.value)}
                    />
                  </Field>
                  <Field label="Environment">
                    <select
                      className={inputClass}
                      value={settings.paymentGateways?.phonepe?.environment || "TEST"}
                      onChange={(e) => patch("paymentGateways.phonepe.environment", e.target.value)}
                    >
                      <option value="UAT">UAT (Sandbox)</option>
                      <option value="PROD">PROD (Live)</option>
                    </select>
                  </Field>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await validateGatewayCredentials({
                        gateway: "phonepe",
                        merchantId: settings.paymentGateways?.phonepe?.merchantId,
                        saltKey: settings.paymentGateways?.phonepe?.saltKey || "existing_secret_token",
                        saltIndex: settings.paymentGateways?.phonepe?.saltIndex || "1",
                        environment: settings.paymentGateways?.phonepe?.environment || "UAT",
                      });
                      setMessage({ type: "success", text: res.data?.message || "PhonePe credentials validated!" });
                      save();
                    } catch (err) {
                      setMessage({ type: "error", text: err.response?.data?.message || "Validation failed." });
                    }
                  }}
                  className="px-3.5 py-1.5 rounded-xl border border-[#FD5302] text-[#C2410C] text-xs font-bold hover:bg-[#FD5302]/5"
                >
                  Verify & Save PhonePe Credentials
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* ---------- MEDIA ---------- */}
        {tab === "media" ? <MediaLibrary /> : null}
      </div>
      </div>

      <SecurityPinModal
        isOpen={pinModalOpen}
        onClose={() => {
          setPinModalOpen(false);
          setPendingAction(null);
        }}
        onSuccess={() => {
          setPinModalOpen(false);
          if (pendingAction) pendingAction();
          setPendingAction(null);
        }}
      />
    </div>
  );
};

export default WebsiteSettings;
