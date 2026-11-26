import "./styles.css";
import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import { api, getAuth, setAuth } from "./lib/api.js";
import { onChange, sync, syncStatus, clearLocal, setOnSignedOut } from "./lib/store.js";
import { fyOf, fyChoices, today } from "./lib/fy.js";
import { esc, openSheet, toast, uid } from "./lib/ui.js";
import { applyTheme } from "./lib/theme.js";
import { renderHome } from "./views/home.js";
import { renderInvoices, invoiceForm } from "./views/invoices.js";
import { renderExpenses, expenseForm } from "./views/expenses.js";
import { renderGst } from "./views/gst.js";
import { renderMore, capitalForm } from "./views/more.js";

const app = document.getElementById("app");

// ---- theme ----
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

// ---- state ----
const ctx = {
  fy: localStorage.getItem("kkb.fy") || fyOf(today()),
  tab: "home",
  rerender: () => render(),
  signOut: () => signOut(),
};

const ICONS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  invoices: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h8"/>',
  expenses: '<path d="M4 4h16v16l-3-2-3 2-2-2-2 2-3-2-3 2z"/><path d="M8 9h8M8 13h5"/>',
  gst: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
};
const TABS = [["home", "Home"], ["invoices", "Invoices"], ["expenses", "Expenses"], ["gst", "GST"], ["more", "More"]];
const VIEWS = { home: renderHome, invoices: renderInvoices, expenses: renderExpenses, gst: renderGst, more: renderMore };

const shell = () => {
  app.innerHTML = `
    <div class="top">
      <h1><small>KNOTKITCHEN</small>Books</h1>
      <span class="sync" id="sync" title="Sync"></span>
      <select id="fy" aria-label="Financial year">${fyChoices().map((f) => `<option${f === ctx.fy ? " selected" : ""}>${f}</option>`).join("")}</select>
    </div>
    <main id="view"></main>
    <button class="fab" id="fab" aria-label="Add">+</button>
    <nav class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>${l}</button>`).join("")}</nav>`;
  app.querySelector("#fy").onchange = (e) => {
    ctx.fy = e.target.value;
    localStorage.setItem("kkb.fy", ctx.fy);
    render();
  };
  app.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  app.querySelector("#fab").onclick = () =>
    openSheet({
      title: "Add",
      full: false,
      body: `<button class="btn block" data-n="inv">New invoice</button><button class="btn block" data-n="exp">New expense</button><button class="btn block" data-n="cap">Partner entry</button>`,
      onMount: (el, close) =>
        el.querySelectorAll("[data-n]").forEach((b) => (b.onclick = () => {
          close();
          // Let the closing sheet's history step settle before opening the next one.
          setTimeout(() => ({ inv: () => invoiceForm(ctx), exp: () => expenseForm(ctx), cap: () => capitalForm(ctx) })[b.dataset.n](), 50);
        })),
    });
};

const go = (tab) => {
  ctx.tab = tab;
  render();
  window.scrollTo(0, 0);
};

const showSync = () => {
  const el = document.getElementById("sync");
  if (!el) return;
  const s = syncStatus();
  el.className = `sync ${s === "pending" ? "pending" : s === "ok" ? "" : "off"}`;
  el.title = { ok: "Synced", pending: "Waiting to sync", offline: "Offline: saved on this phone", error: "Sync error" }[s];
};

const render = () => {
  if (!document.getElementById("view")) shell();
  app.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === ctx.tab));
  VIEWS[ctx.tab](document.getElementById("view"), ctx);
  showSync();
};
const redraw = () => {
  if (getAuth()?.token && document.getElementById("view") && !document.querySelector(".sheet")) render();
  else showSync();
};
onChange(redraw);
window.addEventListener("sheets-closed", redraw);

// ---- sign-in ----
const signOut = (message, keepData = false) => {
  setAuth(null);
  if (!keepData) clearLocal();
  if (Capacitor.isNativePlatform()) SocialLogin.logout({ provider: "google" }).catch(() => {});
  login(message);
};
setOnSignedOut((m, keep) => signOut(m, keep));

const login = async (message) => {
  app.innerHTML = `
    <div class="login">
      <div class="logo">KnotKitchen <em>Books</em></div>
      <p>The firm's invoices, expenses, GST and partner accounts, shared by both partners.</p>
      ${message ? `<div class="notice warn">${esc(message)}</div>` : ""}
      <button class="btn primary" id="g" style="margin-top:12px">Sign in with Google</button>
      <div id="dev"></div>
      <p class="small" id="msg"></p>
    </div>`;
  const msg = app.querySelector("#msg");
  let cfg = { googleClientId: "", devLogin: false };
  try {
    cfg = await api("/auth/config");
  } catch {
    msg.textContent = "No connection. Connect to the internet to sign in.";
  }
  // Set up Google now, not on the tap: on the website the popup must open straight from the tap.
  if (cfg.googleClientId) SocialLogin.initialize({ google: { webClientId: cfg.googleClientId } }).catch(() => {});
  if (cfg.devLogin) {
    app.querySelector("#dev").innerHTML = `<label class="f" style="margin-top:16px"><span>Local test sign-in (email)</span><input id="de" type="email"></label><button class="btn" id="db">Sign in for testing</button>`;
    app.querySelector("#db").onclick = async () => {
      try {
        finish(await api("/auth/dev", { method: "POST", body: { email: app.querySelector("#de").value } }));
      } catch (err) {
        msg.textContent = err.message;
      }
    };
  }
  app.querySelector("#g").onclick = async () => {
    msg.textContent = "";
    if (!cfg.googleClientId) {
      msg.textContent = "Google sign-in is not set up on the server yet.";
      return;
    }
    try {
      // Google requires a nonce when it hands an ID token to a web page.
      const res = await SocialLogin.login({ provider: "google", options: { scopes: ["email", "profile"], nonce: uid() } });
      const idToken = res?.result?.idToken;
      if (!idToken) throw new Error("Google did not return a sign-in.");
      finish(await api("/auth/google", { method: "POST", body: { idToken } }));
    } catch (err) {
      msg.textContent = err.message || "Sign-in failed.";
    }
  };
};

const finish = async (auth) => {
  setAuth(auth);
  toast(`Signed in as ${auth.email}`);
  render();
  await sync();
};

// On the website, Google returns to this page inside the sign-in popup. Loading the
// sign-in plugin there hands the result back to the main window and closes the popup.
const isOAuthReturn = !Capacitor.isNativePlatform() && window.opener && /(id_token|access_token|error)=/.test(location.hash + location.search);
if (isOAuthReturn) SocialLogin.initialize({}).catch(() => window.close());
else if (getAuth()?.token) {
  render();
  sync();
} else login();
