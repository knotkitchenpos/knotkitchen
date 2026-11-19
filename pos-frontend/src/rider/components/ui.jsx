import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STAGES } from "../format";

/* ------------------------------------------------------------------ icons -- */

const svg = (d, { fill = false, size = 22 } = {}) =>
  function Icon({ s = size, className = "" }) {
    return (
      <svg
        width={s}
        height={s}
        viewBox="0 0 24 24"
        fill={fill ? "currentColor" : "none"}
        stroke={fill ? "none" : "currentColor"}
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={className}
      >
        {d}
      </svg>
    );
  };

export const Icon = {
  home: svg(
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M10 20v-5h4v5" />
    </>,
  ),
  bike: svg(
    <>
      <circle cx="5.5" cy="17" r="3" />
      <circle cx="18.5" cy="17" r="3" />
      <path d="M8.5 17h6l-3-7h4l3 7" />
      <path d="M11 6h3" />
    </>,
  ),
  list: svg(
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>,
  ),
  user: svg(
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </>,
  ),
  phone: svg(
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />,
  ),
  nav: svg(<path d="M3 11 21 3l-8 18-2-8-8-2Z" />),
  pin: svg(
    <>
      <path d="M12 22s7-7.4 7-12.5A7 7 0 0 0 5 9.5C5 14.6 12 22 12 22Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>,
  ),
  store: svg(
    <>
      <path d="M3 9 4.5 4h15L21 9" />
      <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
      <path d="M5 12v8h14v-8" />
    </>,
  ),
  check: svg(<path d="M20 6 9 17l-5-5" />),
  x: svg(<path d="M18 6 6 18M6 6l12 12" />),
  back: svg(<path d="M15 18 9 12l6-6" />),
  chevron: svg(<path d="m9 18 6-6-6-6" />),
  bell: svg(
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>,
  ),
  wifiOff: svg(
    <>
      <path d="m2 2 20 20" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.3-1.6M2 8.8A15 15 0 0 1 6.5 6M22 8.8A15 15 0 0 0 11 5" />
      <path d="M12 20h.01" />
    </>,
  ),
  search: svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>,
  ),
  cash: svg(
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </>,
  ),
  clock: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
  ),
  moon: svg(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />),
  sound: svg(
    <>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
    </>,
  ),
  vibrate: svg(
    <>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M3 8v8M21 8v8" />
    </>,
  ),
  lock: svg(
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>,
  ),
  logout: svg(
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </>,
  ),
  download: svg(
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </>,
  ),
  info: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v5h1" />
    </>,
  ),
  refresh: svg(
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v6h-6" />
    </>,
  ),
};

/* ----------------------------------------------------------------- badges -- */

const TONES = {
  brand: ["var(--r-brand-soft)", "var(--r-brand-ink)"],
  blue: ["var(--r-blue-soft)", "var(--r-blue)"],
  green: ["var(--r-green-soft)", "var(--r-green)"],
  amber: ["var(--r-amber-soft)", "var(--r-amber)"],
  red: ["var(--r-red-soft)", "var(--r-red)"],
  grey: ["var(--r-card-2)", "var(--r-ink-2)"],
};

export function Pill({ tone = "grey", children, className = "" }) {
  const [bg, fg] = TONES[tone] || TONES.grey;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-extrabold tracking-wide ${className}`}
      style={{ background: bg, color: fg }}
    >
      {children}
    </span>
  );
}

export function StageBadge({ stage }) {
  const s = STAGES[stage] || {
    badge: String(stage || "").toUpperCase(),
    tone: "grey",
  };
  return <Pill tone={s.tone}>{s.badge}</Pill>;
}

/* ------------------------------------------------------------------ sheet -- */

/**
 * A bottom sheet on a phone, a centred dialog on a wide screen. Esc and the
 * backdrop close it. Drawn at the app root (inside .rider, for the theme), so
 * a sheet opened from the fixed action bar is never under the bottom bar.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  labelledBy = "r-sheet-title",
}) {
  const panel = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    const prev = document.activeElement;
    setTimeout(
      () =>
        panel.current?.querySelector("input,button,textarea,select")?.focus(),
      50,
    );
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  const host =
    typeof document !== "undefined"
      ? document.querySelector(".rider") || document.body
      : null;
  if (!host) return null;
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="r-fade absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="r-sheet-in relative w-full max-w-[480px] rounded-t-[26px] p-5 r-safe-bottom sm:rounded-[26px]"
        style={{ background: "var(--r-card)" }}
      >
        <div
          className="mx-auto mb-3 h-1.5 w-10 rounded-full sm:hidden"
          style={{ background: "var(--r-line)" }}
        />
        {title ? (
          <h2 id={labelledBy} className="mb-3 text-[19px] font-extrabold">
            {title}
          </h2>
        ) : null}
        {children}
      </div>
    </div>,
    host,
  );
}

/** "Are you sure?" for the actions that matter. */
export function Confirm({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  tone = "primary",
  busy,
  disabled,
  onConfirm,
  onClose,
  children,
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {body ? (
        <p className="r-muted mb-4 text-[15px] leading-relaxed">{body}</p>
      ) : null}
      {children}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button type="button" className="r-btn r-btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || disabled}
          className={`r-btn ${tone === "danger" ? "r-btn-danger" : tone === "green" ? "r-btn-green" : "r-btn-primary"}`}
          onClick={onConfirm}
        >
          {busy ? "Please wait…" : confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------- PIN field -- */

/** A PIN as big dots, typed on the phone's number pad. */
export function PinField({
  id,
  label,
  value,
  onChange,
  autoFocus,
  length = 4,
}) {
  const input = useRef(null);
  const [focused, setFocused] = useState(false);
  const slots = Math.max(length, value.length);
  return (
    <div>
      <label htmlFor={id} className="r-label">
        {label}
      </label>
      <div className="relative" onClick={() => input.current?.focus()}>
        <input
          ref={input}
          id={id}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]*"
          maxLength={6}
          autoFocus={autoFocus}
          value={value}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) =>
            onChange(e.target.value.replace(/\D/g, "").slice(0, 6))
          }
          className="absolute inset-0 h-full w-full opacity-0"
          aria-describedby={`${id}-hint`}
        />
        <div className="flex gap-2.5" aria-hidden="true">
          {Array.from({ length: slots }).map((_, i) => (
            <div
              key={i}
              className="flex h-[58px] flex-1 items-center justify-center rounded-2xl text-[26px] font-black"
              style={{
                background: "var(--r-card)",
                border: `2px solid ${focused && i === Math.min(value.length, slots - 1) ? "var(--r-brand)" : "var(--r-line)"}`,
              }}
            >
              {value[i] ? "•" : ""}
            </div>
          ))}
        </div>
      </div>
      <p id={`${id}-hint`} className="r-faint mt-1.5 text-[12.5px]">
        4 to 6 digits
      </p>
    </div>
  );
}

/* ------------------------------------------------------- empty & loading -- */

export function Empty({ emoji, title, body, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 text-[44px]" aria-hidden="true">
        {emoji}
      </div>
      <h3 className="text-[18px] font-extrabold">{title}</h3>
      {body ? (
        <p className="r-muted mt-1 max-w-[300px] text-[14.5px] leading-relaxed">
          {body}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function CardSkeleton({ rows = 3 }) {
  return (
    <div className="r-card space-y-3 p-4" aria-busy="true" aria-label="Loading">
      <div className="r-skeleton h-5 w-1/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="r-skeleton h-4"
          style={{ width: `${90 - i * 15}%` }}
        />
      ))}
      <div className="r-skeleton h-12 w-full" />
    </div>
  );
}

export function ErrorCard({ message, onRetry }) {
  return (
    <div className="r-card p-5 text-center">
      <p className="text-[15px] font-bold">{message}</p>
      {onRetry ? (
        <button
          type="button"
          className="r-btn r-btn-ghost mt-3"
          onClick={onRetry}
        >
          <Icon.refresh s={18} /> Try again
        </button>
      ) : null}
    </div>
  );
}

/** Page title row with an optional back button. */
export function TopBar({ title, onBack, right }) {
  return (
    <header
      className="sticky top-0 z-20 flex items-center gap-2 px-3 pb-2 r-safe-top"
      style={{ background: "var(--r-bg)" }}
    >
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="r-focus flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "var(--r-card)" }}
        >
          <Icon.back />
        </button>
      ) : null}
      <h1 className="min-w-0 flex-1 break-words px-1 text-[19px] font-extrabold leading-tight">
        {title}
      </h1>
      {right}
    </header>
  );
}

/** A switch for settings rows. */
export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="r-focus relative h-8 w-[52px] shrink-0 rounded-full transition-colors disabled:opacity-50"
      style={{ background: checked ? "var(--r-green)" : "var(--r-line)" }}
    >
      <span
        className="absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all"
        style={{ left: checked ? 24 : 4 }}
      />
    </button>
  );
}
