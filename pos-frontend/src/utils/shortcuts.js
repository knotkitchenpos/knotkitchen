import { useEffect, useState } from "react";
import { readStoreScoped, writeStoreScoped } from "./storeSession";

/**
 * Quick Shortcuts: Settings options pinned to the side panel by a long-press
 * (pages/Settings.jsx). Kept on this device, per store. The ids are Settings
 * MENU_ITEMS ids.
 */
const KEY = "kk_quick_shortcuts";
const EVENT = "kk:shortcuts";

export const readShortcuts = () => {
  const list = readStoreScoped(KEY, []);
  return Array.isArray(list) ? list.filter((id) => typeof id === "string") : [];
};

/** Pin or unpin; returns true when it is now pinned. */
export const toggleShortcut = (id) => {
  const list = readShortcuts();
  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  writeStoreScoped(KEY, next);
  window.dispatchEvent(new Event(EVENT));
  return next.includes(id);
};

/** The pinned ids, kept current when they change here or in another tab. */
export const useShortcuts = () => {
  const [list, setList] = useState(readShortcuts);
  useEffect(() => {
    const refresh = () => setList(readShortcuts());
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return list;
};
