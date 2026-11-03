/**
 * A tab left open across a deploy (owner, 2026-11-03: "Failed to fetch
 * dynamically imported module …/Menu-DCfFS6r2.js"). Screens are loaded on
 * demand by file names that change with every build, and a deploy removes the
 * old files, so the first screen such a tab opens afterwards is missing. The
 * fix is the new version: reload once, quietly. A reload in the last
 * RELOAD_GAP_MS that did not help is not repeated, so a real fault still
 * shows instead of reloading for ever.
 */

const KEY = "kk:stale-build-reload-at";
const RELOAD_GAP_MS = 30 * 1000;

/** Is this the "file from an older build is gone" failure? */
export const isStaleBuildError = (error) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed/i
    .test(String(error?.message || error || ""));

/** Reload for the new version, unless that was just tried. True when it reloads. */
export const reloadForNewBuild = () => {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < RELOAD_GAP_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* no sessionStorage: still reload once, this page load */
  }
  window.location.reload();
  return true;
};
