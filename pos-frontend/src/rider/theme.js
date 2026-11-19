import { useEffect, useState, useSyncExternalStore } from "react";

/** Light, dark, or the phone's own setting; kept on this device. */
const KEY = "kk.rider.theme";
const listeners = new Set();
const read = () => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
};
let value = typeof window === "undefined" ? "system" : read();
const set = (v) => {
  value = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* private mode: this session only */
  }
  listeners.forEach((l) => l());
};
const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useTheme = () => [useSyncExternalStore(subscribe, () => value), set];

/** true when the app should draw dark: the choice, or the phone's when "system". */
export const useIsDark = () => {
  const [theme] = useTheme();
  const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const [systemDark, setSystemDark] = useState(Boolean(media?.matches));
  useEffect(() => {
    if (!media) return undefined;
    const on = (e) => setSystemDark(e.matches);
    media.addEventListener?.("change", on);
    return () => media.removeEventListener?.("change", on);
  }, [media]);
  return theme === "dark" || (theme === "system" && systemDark);
};
