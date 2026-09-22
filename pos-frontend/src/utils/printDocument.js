import { Capacitor } from "@capacitor/core";

/**
 * Print an HTML document in browsers and Android WebViews.
 * Android WebView/PWA contexts can block window.open, so the iframe fallback
 * keeps receipt printing available from the APK as well.
 */
export const printHtmlDocument = (html) => {
  // Inside the Android app window.open hands back the POS page itself, so the
  // document replaced the whole till, and print() does nothing there anyway.
  if (Capacitor.isNativePlatform()) {
    throw new Error("No receipt printer is set up for this takeaway on this device. Set one up in Settings → Device Configuration.");
  }
  let printWindow = null;

  try {
    printWindow = window.open("", "_blank", "width=400,height=600");
  } catch {
    printWindow = null;
  }

  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
    return true;
  }

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Printable receipt");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "1px";
  iframe.style.height = "1px";
  iframe.style.border = "0";
  iframe.style.opacity = "0.01";
  document.body.appendChild(iframe);

  const frameDocument = iframe.contentDocument || iframe.contentWindow?.document;
  if (!frameDocument) {
    iframe.remove();
    return false;
  }

  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();

  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 1000);
  }, 300);

  return true;
};