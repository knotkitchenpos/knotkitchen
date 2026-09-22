import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import MediaLibrary from "../components/media/MediaLibrary";
import SecurityPinModal from "../components/common/SecurityPinModal";
import { isOwner, checkActionAuthorization } from "../utils/security";
import { getWebsiteSettings, updateWebsiteSettings, validateGatewayCredentials } from "../https/storefrontApi";
import { getMenus, getSubscriptionStatus, publishWebsiteCache } from "../https";

/**
 * Settings → Website (§3, §19, §26).
 *
 * Every control here maps to a whitelisted field on the backend. There is
 * deliberately no "custom CSS/HTML" input: appearance is configured through
 * predefined safe options only.
 */

const TABS = [
  { key: "general", label: "Domain & General" },
  { key: "content", label: "About & Popular Items" },
  { key: "contact", label: "Contact" },
  { key: "legal", label: "Legal Pages" },
  { key: "payments", label: "Payment Gateway" },
  { key: "media", label: "Website Images" },
];

/**
 * The words on the home page. Empty = the design's own wording, so a store
 * only fills in what it wants to change. Keys and limits match
 * landingCopySchema on the server.
 */
const HOME_TEXT_FIELDS = [
  ["kicker", "Small line above the headline", 60],
  ["headline", "Headline", 80],
  ["headlineAccent", "Headline, second line (coloured)", 80],
  ["lead", "Intro sentence under the headline", 300],
  ["ctaText", "Main button", 40],
  ["heroBadge", "Badge on the main photo", 30],
  ["storyTitle", "About section heading", 80],
  ["storyAccent", "About section heading, second line", 80],
  ["menuTitle", "Popular items heading", 80],
  ["menuAccent", "Popular items heading, second line", 80],
  ["ctaTitle", "Order banner heading", 80],
  ["ctaLead", "Order banner sentence", 160],
  ["visitTitle", "Visit us heading", 80],
  ["hoursText", "Visit us note", 120],
  ["footerTagline", "Footer line", 80],
];

/** Manage Website > Legal: the windows the policy pages print, with their defaults. */
const LEGAL_FIELDS = [
  ["refundWindowHours", "Refund request window (hours after delivery)", 24],
  ["refundAckHours", "Acknowledge a refund request within (hours)", 24],
  ["refundDecisionDays", "Decide a refund within (business days)", 3],
  ["refundProcessingDays", "Pay an approved refund within (business days)", 7],
  ["returnWindowDays", "Return window for packaged items (days)", 7],
];

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

const WebsiteSettings = () => {
  const user = useSelector((state) => state.user);
  const [settings, setSettings] = useState(null);
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

  // Every dish on the website menu, for the Popular Items picker. The list
  // comes from the live menu, so a renamed or repriced dish is already right.
  const [dishes, setDishes] = useState([]);
  const [dishQuery, setDishQuery] = useState("");
  // Which photo slot the image picker is filling ("" = closed).
  const [pickingImage, setPickingImage] = useState("");
  // The website is a Growth and Scale feature (the server enforces it too).
  // On Connect this page is the payment gateway only; Essential has neither.
  const { data: subRes } = useQuery({ queryKey: ["subscription"], queryFn: getSubscriptionStatus });
  const websiteLocked = subRes?.data?.data?.features?.website === false;
  const gatewayLocked = subRes?.data?.data?.features?.paymentGateway === false;
  const tabs = websiteLocked ? TABS.filter((t) => t.key === "payments") : TABS;
  useEffect(() => {
    if (websiteLocked) setTab("payments");
  }, [websiteLocked]);
  useEffect(() => {
    let live = true;
    getMenus({ source: "website" })
      .then((res) => {
        const menus = res?.data?.data || res?.data?.menus || [];
        const list = (Array.isArray(menus) ? menus : []).flatMap((m) =>
          (m.items || []).map((it) => ({ id: String(it._id), name: it.name, category: m.name, price: it.price, image: it.image || it.imageUrl || "" })),
        );
        if (live) setDishes(list);
      })
      .catch(() => live && setDishes([]));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await getWebsiteSettings();
        const { settings: s, themes: t, storefrontUrl: url } = res.data.data;
        setSettings(s);
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
    // Gateway only below Growth: the rest of the page is not theirs to save.
    const res = await updateWebsiteSettings(websiteLocked ? { paymentGateways: settings.paymentGateways } : settings);
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
   * Publish = save what is in this editor, then put the website live: its
   * menu and this page's draft. The tills have their own button, under
   * Settings > Manage Cache.
   *
   * For a while this only saved, and the draft waited for Publish System --
   * so the button said "published" and the website did not change.
   */
  const publish = async () => {
    executeWithSecurity(async () => {
      try {
        setSaving(true);
        setMessage(null);
        await persist();
        const res = await publishWebsiteCache();
        setMessage({ type: "success", text: res.data?.message || "Website published." });
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

  if (websiteLocked && gatewayLocked) return <Navigate to="/settings/billing" replace />;

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
          <h1 className="text-2xl font-extrabold text-[#0F172A]">{websiteLocked ? "Payment Gateway" : "Website"}</h1>
          {websiteLocked ? (
            <p className="text-sm text-[#64748B]">
              The website is included in Growth and Scale.{" "}
              <Link to="/settings/billing" className="font-semibold text-[#C2410C] hover:underline">Upgrade</Link>
            </p>
          ) : (
            <a
              href={storefrontUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-[#C2410C] hover:underline break-all"
            >
              {storefrontUrl}
            </a>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {!websiteLocked && (
          <button
            type="button"
            onClick={publish}
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-[#22C55E] text-white text-sm font-bold hover:bg-[#16A34A] shadow-sm disabled:opacity-60"
          >
            🚀 Publish Website
          </button>
          )}
          {/* Preview opens the REAL customer website.
              It used to open /website/preview, a second storefront living
              inside the POS that renders one fixed design and knows nothing
              about landing templates -- so every template previewed
              identically, and the landing page never appeared at all. */}
          {!websiteLocked && (
          <a
            href={storefrontUrl}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-xl border border-[#E2E8F0] bg-white text-sm font-bold text-[#475569] hover:border-[#C7C2FF] hover:text-[#C2410C]"
          >
            👁 Preview
          </a>
          )}
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
        {tabs.map((t) => (
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
                    <p className="text-[#64748B] font-mono">CNAME → cname.knotkitchen.com</p>
                    <p className="text-[#64748B] font-mono">TXT → knotkitchen-verify={settings.storeId}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5">
              <Field
                label="Website Address"
                hint="Your store ID is your website address. It never changes."
              >
                <input
                  className={`${inputClass} bg-[#F8FAFC] text-[#475569]`}
                  value={storefrontUrl || `https://${settings.storeId}.knotkitchen.com`}
                  readOnly
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

        {["general", "content", "contact", "legal", "media"].includes(tab) ? (
          <p className="mb-4 rounded-xl border border-[#FED7AA] bg-[#FFF7ED] p-3 text-xs text-[#9A3412]">
            Saved changes to the website&apos;s look and text stay as a draft. They go live, with the latest menu,
            when you press <span className="font-bold">Publish Website</span> above. Domain, on/off and payment
            settings apply as soon as they are saved.
          </p>
        ) : null}

        {/* ---------- CONTENT: about, description, popular items ---------- */}
        {tab === "content" ? (
          <div className="space-y-5">
            <Field
              label="Store description"
              hint="One or two lines under the restaurant name, and the description search engines show. Up to 400 characters."
            >
              <textarea
                className={`${inputClass} min-h-[80px]`}
                maxLength={400}
                value={settings.branding?.siteDescription || ""}
                onChange={(e) => patch("branding.siteDescription", e.target.value)}
              />
            </Field>
            <Field label="About us" hint="The story section of the website. Up to 4000 characters.">
              <textarea
                className={`${inputClass} min-h-[180px]`}
                maxLength={4000}
                value={settings.landing?.aboutText || settings.branding?.aboutText || ""}
                onChange={(e) => patch("landing.aboutText", e.target.value)}
              />
            </Field>
            <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4 space-y-4">
              <div>
                <p className="text-sm font-bold text-[#0F172A]">Photos</p>
                <p className="text-xs text-[#94A3B8]">Pick from Website Images, or upload a new one there.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  ["landing.backgroundImage", settings.landing?.backgroundImage, "Home page main photo"],
                  ["branding.coverImage", settings.branding?.coverImage, "Menu page banner"],
                ].map(([path, value, label]) => (
                  <div key={path}>
                    <p className="text-xs font-bold text-[#475569] mb-1.5">{label}</p>
                    <div className="h-32 rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] overflow-hidden flex items-center justify-center text-xs text-[#94A3B8]">
                      {value?.url ? <img src={value.thumbnailUrl || value.url} alt="" className="h-full w-full object-cover" /> : "No photo chosen"}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => setPickingImage(path)} className="px-3 py-1.5 rounded-lg border border-[#E2E8F0] text-xs font-bold text-[#0F172A]">
                        {value?.url ? "Change" : "Choose photo"}
                      </button>
                      {value?.url ? (
                        <button type="button" onClick={() => patch(path, null)} className="px-3 py-1.5 rounded-lg border border-[#FECACA] text-xs font-bold text-[#DC2626]">
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              <Field label="Menu page line" hint="Under the restaurant name on the menu page banner.">
                <input
                  className={inputClass}
                  maxLength={200}
                  value={settings.branding?.tagline || ""}
                  onChange={(e) => patch("branding.tagline", e.target.value)}
                />
              </Field>
            </div>

            <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4 space-y-4">
              <div>
                <p className="text-sm font-bold text-[#0F172A]">Home page text</p>
                <p className="text-xs text-[#94A3B8]">Leave a box empty to keep the design&apos;s own wording.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {HOME_TEXT_FIELDS.map(([key, label, max]) => (
                  <Field key={key} label={label}>
                    <input
                      className={inputClass}
                      maxLength={max}
                      value={settings.landing?.copy?.[key] || ""}
                      onChange={(e) => patch(`landing.copy.${key}`, e.target.value)}
                    />
                  </Field>
                ))}
                {[0, 1, 2].map((i) => (
                  <Field key={`feature-${i}`} label={`Highlight ${i + 1}`}>
                    <input
                      className={inputClass}
                      maxLength={60}
                      value={settings.landing?.features?.[i]?.title || ""}
                      onChange={(e) => {
                        const features = [0, 1, 2].map((k) => ({ ...(settings.landing?.features?.[k] || {}) }));
                        features[i].title = e.target.value;
                        patch("landing.features", features);
                      }}
                    />
                  </Field>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-bold text-[#475569] mb-1.5">Popular items</p>
              <p className="text-xs text-[#94A3B8] mb-2">
                Up to three dishes shown on the home page. Name, photo and price come from the menu, so they stay in
                step with the POS. Choose none and the website shows the three best sellers of the last 30 days.
              </p>
              {dishes.length ? (
                <>
                  <input
                    className={`${inputClass} mb-2`}
                    placeholder="Search dishes…"
                    value={dishQuery}
                    onChange={(e) => setDishQuery(e.target.value)}
                  />
                  <div className="max-h-72 overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white">
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
                            {d.image ? <img src={d.image} alt="" className="h-9 w-9 rounded-lg object-cover" /> : null}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-bold text-[#0F172A]">{d.name}</span>
                              <span className="block truncate text-xs text-[#94A3B8]">
                                {d.category}
                                {d.price != null ? ` · ₹${d.price}` : ""}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                  </div>
                  <p className="mt-2 text-xs text-[#94A3B8]">{(settings.landing?.featuredItems || []).length} of 3 chosen.</p>
                </>
              ) : (
                <p className="text-xs text-[#94A3B8]">No dishes on the website menu yet. Add them under Manage Menu first.</p>
              )}
            </div>
          </div>
        ) : null}

        {/* ---------- CONTACT ---------- */}
        {tab === "contact" ? (
          <>
            <p className="mb-4 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs text-[#64748B]">
              Leave a field blank to use the restaurant&apos;s details from Settings › Store Properties (address, phone,
              email, Google Maps pin). Fill it in only to show something different on the website.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                ["phone", "Phone"],
                ["email", "Email"],
                ["addressLine1", "Address Line 1"],
                ["addressLine2", "Address Line 2"],
                ["city", "City"],
                ["postalCode", "Postcode"],
                ["mapUrl", "Google Maps link"],
              ].map(([key, label]) => (
                <Field key={key} label={label}>
                  <input
                    className={inputClass}
                    placeholder={key === "mapUrl" ? "https://maps.app.goo.gl/…" : "From Store Properties"}
                    value={settings.contact?.[key] || ""}
                    onChange={(e) => patch(`contact.${key}`, e.target.value)}
                  />
                </Field>
              ))}
            </div>
          </>
        ) : null}

        {/* ---------- LEGAL PAGES ---------- */}
        {tab === "legal" ? (
          <div className="space-y-5">
            <p className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs text-[#64748B]">
              The website carries five legal pages, linked from every footer: Terms &amp; Conditions, Privacy Policy,
              Refund &amp; Cancellation Policy, Return Policy, and Shipping &amp; Delivery Policy. The restaurant&apos;s
              name, address, FSSAI number, GSTIN, phone and email are taken from Store Properties. The values below are
              the parts the policies let you set.
            </p>
            <div>
              <p className="text-sm font-bold text-[#475569] mb-1.5">Grievance officer</p>
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  ["grievanceName", "Name", "The owner, unless someone else handles complaints"],
                  ["grievanceEmail", "Email", "Defaults to the contact email"],
                  ["grievancePhone", "Phone", "Defaults to the contact phone"],
                  ["grievanceHours", "Hours", "e.g. 10 AM – 8 PM, all days"],
                ].map(([key, label, hint]) => (
                  <Field key={key} label={label} hint={hint}>
                    <input
                      className={inputClass}
                      value={settings.legal?.[key] || ""}
                      onChange={(e) => patch(`legal.${key}`, e.target.value)}
                    />
                  </Field>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-bold text-[#475569] mb-1.5">Refund and return windows</p>
              <div className="grid sm:grid-cols-2 gap-4">
                {LEGAL_FIELDS.map(([key, label, fallback]) => (
                  <Field key={key} label={label} hint={`Default ${fallback}`}>
                    <input
                      type="number"
                      min={1}
                      className={inputClass}
                      value={settings.legal?.[key] ?? fallback}
                      onChange={(e) => patch(`legal.${key}`, e.target.value === "" ? "" : Number(e.target.value))}
                    />
                  </Field>
                ))}
                <Field label="Courts of" hint="City whose courts hear disputes. Defaults to the restaurant's city.">
                  <input
                    className={inputClass}
                    value={settings.legal?.jurisdictionCity || ""}
                    onChange={(e) => patch("legal.jurisdictionCity", e.target.value)}
                  />
                </Field>
              </div>
            </div>
            {storefrontUrl ? (
              <div className="flex flex-wrap gap-2 text-xs">
                {[
                  ["terms", "Terms & Conditions"],
                  ["privacy", "Privacy Policy"],
                  ["refund-cancellation", "Refund & Cancellation"],
                  ["return", "Return Policy"],
                  ["shipping-delivery", "Shipping & Delivery"],
                ].map(([key, label]) => (
                  <a
                    key={key}
                    href={`${storefrontUrl.replace(/\/$/, "")}/legal/${key}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-[#E2E8F0] px-3 py-1.5 font-semibold text-[#C2410C] hover:border-[#FD5302]"
                  >
                    {label} ↗
                  </a>
                ))}
              </div>
            ) : null}
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
              <h3 className="font-bold text-[#0F172A] text-base mb-1">Payment Gateways</h3>
              <p className="text-xs text-[#94A3B8]">
                Configure Cashfree or PhonePe gateway credentials. Only ONE gateway can be active at a time for website and table QR payments.
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
              <div className="p-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] text-xs text-[#92400E]">
                Enter <strong>this restaurant&apos;s own</strong> payment gateway keys. Every website and table QR
                payment settles to the account these keys belong to. Never enter KnotKitchen&apos;s keys here.
              </div>
              <Field label="Select Active Gateway" hint="Website and table QR payments will use this gateway.">
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

        {pickingImage ? (
          <MediaLibrary
            mode="picker"
            onClose={() => setPickingImage("")}
            onSelect={(asset) => {
              patch(pickingImage, { mediaId: asset._id, url: asset.url, thumbnailUrl: asset.thumbnailUrl || asset.url });
              setPickingImage("");
            }}
          />
        ) : null}
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
