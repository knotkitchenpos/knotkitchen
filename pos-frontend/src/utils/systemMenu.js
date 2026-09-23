import { getMenus } from "../https";
import { getActiveStoreId, readStoreScoped, writeStoreScoped } from "./storeSession";
import { thumbUrl } from "./index";

/**
 * The POS menu kept on this device.
 *
 * The till opens from the saved copy at once, then asks the server only for
 * the menu's version and downloads the menu again when that changed. The
 * product photos (the small grid and list copies) are fetched ahead so they
 * show without internet too; the browser keeps them, as /uploads is served
 * immutable. Settings > Manage Cache has the "Check for updates" button.
 */
const KEY = "kk.menu.system.v2";
const OLD_KEY = "kk.menu.system.v1";

/** { body: { success, data: [...] }, version, savedAt, checkedAt, photos } or null. */
export const readSavedMenu = () => {
  const saved = readStoreScoped(KEY, null);
  if (saved?.body) return saved;
  const old = readStoreScoped(OLD_KEY, null);
  return old?.data ? { body: old, version: "", savedAt: 0, checkedAt: 0 } : null;
};

const save = (next) => {
  // Free the old copy first: both at once may not fit in the storage quota.
  writeStoreScoped(OLD_KEY, null);
  writeStoreScoped(KEY, next);
  return next;
};

/** Per store, so switching takeaways in one tab never shows the other's menu. */
export const systemMenuKey = () => ["menus", "system", getActiveStoreId()];

/**
 * The queryFn for ["menus", "system"]. Returns the shape ProductPanel reads
 * (`res.data.data` is the menu list), plus whether anything changed.
 */
export const loadSystemMenu = async () => {
  const saved = readSavedMenu();
  try {
    if (saved?.version) {
      const check = await getMenus({ source: "system", versionOnly: 1 });
      if (check?.data?.version === saved.version) {
        // Read again: a newer menu (another check, another tab) or the photo
        // count may have been saved while this request was out.
        const current = readSavedMenu();
        if (current?.version === saved.version) save({ ...current, checkedAt: Date.now() });
        return { data: (current?.body ? current : saved).body, changed: false };
      }
    }
    const res = await getMenus({ source: "system" });
    const now = Date.now();
    const next = save({ body: res.data, version: res.data?.version || "", savedAt: now, checkedAt: now, photos: saved?.photos });
    savePhotos(next.body?.data);
    return { data: next.body, changed: true };
  } catch (err) {
    // No internet, or the server is unreachable: keep selling from the saved copy.
    if (saved?.body && !err?.response) return { data: saved.body, changed: false, offline: true };
    throw err;
  }
};

export const photoUrls = (menus) => {
  const urls = new Set();
  for (const menu of menus || []) {
    for (const item of menu?.items || []) {
      const img = item?.imageThumbnailUrl || item?.imageUrl || item?.image;
      if (img) {
        urls.add(thumbUrl(img, 320));
        urls.add(thumbUrl(img, 160));
      }
    }
  }
  return [...urls];
};

/** Fetches every product photo, four at a time. Resolves { saved, total }. */
export const savePhotos = async (menus) => {
  const urls = photoUrls(menus);
  const version = readSavedMenu()?.version;
  let ok = 0;
  for (let i = 0; i < urls.length; i += 4) {
    await Promise.all(
      urls.slice(i, i + 4).map(
        (src) =>
          new Promise((done) => {
            const img = new Image();
            img.onload = () => {
              ok += 1;
              done();
            };
            img.onerror = done;
            img.src = src;
          }),
      ),
    );
  }
  const photos = { saved: ok, total: urls.length, at: Date.now() };
  const current = readSavedMenu();
  // Only if it is still the same menu (and the same store) we started with.
  if (current?.version === version) save({ ...current, photos });
  return photos;
};

/** The Manage Cache button: check now, refresh the screen, re-save the photos. */
export const checkMenuNow = async (queryClient) => {
  const res = await loadSystemMenu();
  queryClient.setQueryData(systemMenuKey(), res);
  const photos = await savePhotos(res.data?.data);
  return { ...res, photos };
};
