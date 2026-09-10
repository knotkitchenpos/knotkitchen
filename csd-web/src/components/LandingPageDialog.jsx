import React, { useEffect, useState } from "react";
import { FiX, FiExternalLink } from "react-icons/fi";
import { restaurants as api, errorMessage } from "../api";

/**
 * The restaurant's landing page — the first screen a customer sees before the
 * menu.
 *
 * This lives in CSD rather than in the POS because Manage Website belongs to
 * KnotKitchen support: the POS route refuses `landing` the same way it refuses
 * branding and theme, so this dialog is the only editor there is.
 *
 * Reads are open to any signed-in staff member and the write is admin-only,
 * but the disabling comes from the server's `canEdit` rather than from the
 * signed-in role, so the form matches what the API will actually accept.
 */

const TEMPLATE_LABELS = {
  "hero-classic": "Classic hero",
  "split-showcase": "Split showcase",
  "minimal-center": "Minimal centred",
  "photo-fullbleed": "Full-screen photo",
  "card-stack": "Floating card",
};

const TEMPLATE_HINTS = {
  "hero-classic": "Wide photo, headline over the bottom. Safe with any picture.",
  "split-showcase": "Text on one side, photo on the other. Reads like a magazine.",
  "minimal-center": "No photo at all — brand colour and centred type.",
  "photo-fullbleed": "One photo filling the screen. Needs a strong picture.",
  "card-stack": "Photo behind a solid card. Keeps text readable on a busy photo.",
};

/** Module scope, not inside the dialog — see the note in ChargesDialog. */
const Text = ({ label, name, value, placeholder, hint, maxLength, disabled, onChange }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">{label}</span>
    <input
      name={name}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled}
      className="w-full rounded-xl border border-navy-200 px-3.5 py-2.5 text-sm text-navy-900 outline-none focus:border-brand-500 disabled:bg-navy-50"
    />
    {hint ? <span className="mt-1 block text-xs text-navy-400">{hint}</span> : null}
  </label>
);

const Check = ({ label, name, checked, disabled, onChange }) => (
  <label className="flex items-center gap-2.5 text-sm text-navy-800">
    <input type="checkbox" name={name} checked={checked} disabled={disabled} onChange={onChange}
      className="h-4 w-4 rounded border-navy-300" />
    {label}
  </label>
);

const LandingPageDialog = ({ storeId, onClose }) => {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .landing(storeId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setForm(d.landing);
      })
      .catch((err) => {
        if (!cancelled) setBanner(errorMessage(err, "Could not load the landing page."));
      });
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const set = (e) => {
    const { name, type, checked, value } = e.target;
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
    setBanner("");
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setBanner("");
    try {
      const saved = await api.updateLanding(storeId, {
        template: form.template,
        headline: form.headline,
        subheadline: form.subheadline,
        ctaText: form.ctaText,
        backgroundImageUrl: form.backgroundImageUrl,
        overlayOpacity: Number(form.overlayOpacity),
        showHours: form.showHours,
        showContact: form.showContact,
        showOffers: form.showOffers,
      });
      setData(saved);
      setForm(saved.landing);
      setBanner("Saved. The live site picks this up within a minute.");
    } catch (err) {
      setBanner(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const canEdit = Boolean(data?.canEdit);
  const disabled = !canEdit || busy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label="Landing page"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-navy-900">Landing page</h2>
            <p className="mt-0.5 text-xs text-navy-500">
              The first screen a customer sees. The menu is one tap behind it.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="rounded-lg p-1.5 text-navy-400 hover:bg-navy-50 hover:text-navy-700">
            <FiX size={18} />
          </button>
        </div>

        {banner ? (
          <p className="mb-4 rounded-xl bg-navy-50 px-3.5 py-2.5 text-sm text-navy-800">{banner}</p>
        ) : null}

        {!form ? (
          <p className="py-8 text-center text-sm text-navy-400">Loading…</p>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <fieldset>
              <legend className="mb-2 block text-xs font-semibold uppercase tracking-wider text-navy-600">
                Template
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {(data.templates || []).map((key) => (
                  <label key={key}
                    className={`flex cursor-pointer gap-2.5 rounded-xl border p-3 ${
                      form.template === key ? "border-brand-500 bg-brand-50" : "border-navy-200 hover:bg-navy-50"
                    }`}>
                    <input type="radio" name="template" value={key} checked={form.template === key}
                      disabled={disabled} onChange={set} className="mt-0.5 h-4 w-4" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-navy-900">
                        {TEMPLATE_LABELS[key] || key}
                      </span>
                      <span className="block text-xs text-navy-500">{TEMPLATE_HINTS[key] || ""}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Every text field falls back to the store's branding when left
                blank, so the placeholder shows what the customer would see. */}
            <Text label="Headline" name="headline" value={form.headline} onChange={set}
              disabled={disabled} maxLength={120}
              placeholder={data.fallbacks?.headline || "The restaurant's name"}
              hint="Leave blank to use the site title." />

            <Text label="Sub-headline" name="subheadline" value={form.subheadline} onChange={set}
              disabled={disabled} maxLength={300}
              placeholder={data.fallbacks?.subheadline || "A line about the food"}
              hint="Leave blank to use the tagline." />

            <div className="grid gap-4 sm:grid-cols-2">
              <Text label="Button text" name="ctaText" value={form.ctaText} onChange={set}
                disabled={disabled} maxLength={40} placeholder="View Menu" />

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">
                  Photo darkening — {form.overlayOpacity}%
                </span>
                <input type="range" name="overlayOpacity" min="0" max="100" step="5"
                  value={form.overlayOpacity} disabled={disabled} onChange={set} className="w-full" />
                <span className="mt-1 block text-xs text-navy-400">
                  Raise it until the headline is readable over the photo.
                </span>
              </label>
            </div>

            <Text label="Background image URL" name="backgroundImageUrl" value={form.backgroundImageUrl}
              onChange={set} disabled={disabled} maxLength={500}
              placeholder={data.fallbacks?.backgroundImageUrl || "https://…"}
              hint="Leave blank to use the store's cover image. Must start with http:// or https://." />

            <fieldset className="space-y-2.5">
              <legend className="mb-1 block text-xs font-semibold uppercase tracking-wider text-navy-600">
                Show under the hero
              </legend>
              <Check label="Opening hours" name="showHours" checked={form.showHours} disabled={disabled} onChange={set} />
              <Check label="Address and phone" name="showContact" checked={form.showContact} disabled={disabled} onChange={set} />
              <Check label="Current offers" name="showOffers" checked={form.showOffers} disabled={disabled} onChange={set} />
            </fieldset>

            <div className="flex items-center justify-between gap-3 border-t border-navy-100 pt-4">
              {data.storefrontUrl ? (
                <a href={data.storefrontUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700">
                  Open the site <FiExternalLink size={13} aria-hidden="true" />
                </a>
              ) : <span />}

              <div className="flex gap-3">
                <button type="button" onClick={onClose}
                  className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">
                  Close
                </button>
                {canEdit ? (
                  <button type="submit" disabled={busy}
                    className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                    {busy ? "Saving…" : "Save"}
                  </button>
                ) : null}
              </div>
            </div>

            {!canEdit ? (
              <p className="text-xs text-navy-400">
                Read-only. Changing the landing page is an admin action.
              </p>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
};

export default LandingPageDialog;
