/**
 * The Chrome version of the Android app's WebView when it is older than
 * MIN_CHROME, else null (also null outside the app). An old "Android System
 * WebView" shows the rupee sign broken on Cashfree's payment page.
 */
export const MIN_CHROME = 110;

export const oldWebViewVersion = (ua = typeof navigator === "undefined" ? "" : navigator.userAgent) => {
  if (!ua.includes("; wv)")) return null;
  const major = Number((/Chrome\/(\d+)/.exec(ua) || [])[1]);
  return major && major < MIN_CHROME ? major : null;
};
