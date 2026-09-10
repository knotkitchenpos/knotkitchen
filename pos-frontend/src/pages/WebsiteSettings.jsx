import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import MediaLibrary from "../components/media/MediaLibrary";
import SecurityPinModal from "../components/common/SecurityPinModal";
import { isOwner, checkActionAuthorization } from "../utils/security";
import { getWebsiteSettings, updateWebsiteSettings, validateGatewayCredentials } from "../https/storefrontApi";
import { getMenus } from "../https";

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
  { key: "landing", label: "Landing Page" },
  { key: "theme", label: "Colors & Fonts" },
  { key: "layout", label: "Layout" },
  { key: "ordering", label: "Ordering Options" },
  { key: "payments", label: "Payment Gateway" },
  { key: "hours", label: "Hours" },
  { key: "contact", label: "Contact" },
  { key: "media", label: "Website Images" },
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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

/** A labelled break between groups of fields on a long tab. */
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
            folder="cover"
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

const WebsiteSettings = () => {
  const user = useSelector((state) => state.user);
  const [settings, setSettings] = useState(null);
  const [options, setOptions] = useState(null);
  const [themes, setThemes] = useState([]);
  const [storefrontUrl, setStorefrontUrl] = useState("");
  // Every dish the store sells, flattened, so the landing page's two or three
  // featured items can be picked by name rather than by id.
  const [dishes, setDishes] = useState([]);
  const [dishQuery, setDishQuery] = useState("");
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

  // The menu is only needed by the Landing Page tab, and a store with a large
  // catalogue should not pay for it before the page has even painted -- so it
  // loads on its own and a failure costs the picker, not the screen.
  useEffect(() => {
    (async () => {
      try {
        const res = await getMenus();
        const menus = res.data?.data || res.data || [];
        setDishes(
          (Array.isArray(menus) ? menus : []).flatMap((m) =>
            (m.items || []).map((it) => ({
              id: String(it._id),
              name: it.name,
              category: m.name,
            })),
          ),
        );
      } catch {
        setDishes([]);
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
   * Publish is now just Save.
   *
   * It used to also push the menu snapshot to the website, which meant the
   * button reported success while quietly dropping anything unsaved in this
   * editor. The website reads the live menu, so there is nothing left to push
   * — writing the settings IS publishing them.
   */
  const publish = async () => {
    executeWithSecurity(async () => {
      try {
        setSaving(true);
        setMessage(null);
        await persist();
        setMessage({ type: "success", text: "Website published." });
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
          {/* Preview opens the REAL customer website.
              It used to open /website/preview, a second storefront living
              inside the POS that renders one fixed design and knows nothing
              about landing templates -- so every template previewed
              identically, and the landing page never appeared at all. */}
          <a
            href={storefrontUrl}
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
              folder="cover"
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
                    folder="cover"
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
              folder="cover"
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
