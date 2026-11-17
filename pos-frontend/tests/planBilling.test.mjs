// The ₹199 Billing plan on the POS (services/planFeatures `pos` false): table
// service, marketplace and Knot Eats are locked, and a refused call offers Billing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SRC = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("every Settings tile carries the plan feature that opens it", () => {
  const menu = SRC("src/constants/settingsMenu.js");
  const features = Object.fromEntries(
    [...menu.matchAll(/\{ id: "(\w+)",[^\n]*\}/g)].map(([line, id]) => [id, (line.match(/feature: "(\w+)"/) || [])[1] || null]),
  );
  assert.deepEqual(features, {
    cache: null, device: null, properties: null, menu: null,
    tables: "tableQr", staff: null, toggles: "pos", timings: "websiteHours", rules: null, reports: null,
    shift: "pos", inventory: "pos", billing: null, website: "website", eats: "pos", support: null, logout: null,
  });
});

test("the plan is read before the loader returns, and /tables goes to the lock on the Billing plan", () => {
  const app = SRC("src/App.jsx");
  const query = app.indexOf('useQuery({ queryKey: ["subscription"], queryFn: getSubscriptionStatus, enabled: Boolean(isAuth) && !bare, staleTime: 60_000 })');
  assert.ok(query > 0, "subscription query missing");
  assert.ok(query < app.indexOf("if (isLoading) return <FullScreenLoader />;"), "a hook after the loader return breaks the rules of hooks");
  assert.match(app, /const billingOnly = subRes\?\.data\?\.data\?\.features\?\.pos === false;/);
  assert.match(app, /<Route path="\/tables" element=\{<ProtectedRoutes>\{planLoading \? <FullScreenLoader \/> : billingOnly \? <Navigate to="\/settings\?view=tables" replace \/> : <Tables \/>\}<\/ProtectedRoutes>\} \/>/);
});

test("REGRESSION: a locked screen never draws while the plan loads (/tables, and a gated Settings view)", () => {
  const app = SRC("src/App.jsx");
  // isLoading, not isPending: offline the query pauses and the page still opens.
  assert.match(app, /const \{ data: subRes, isPending: planPending, isLoading: planLoading \} = useQuery\(\{ queryKey: \["subscription"\]/);
  assert.match(app, /\{planLoading \? <FullScreenLoader \/> : billingOnly \?/);
  const settings = SRC("src/pages/Settings.jsx");
  assert.match(settings, /const \{ data: subRes, isLoading: planLoading \} = useQuery\(\{ queryKey: \["subscription"\], queryFn: getSubscriptionStatus \}\);/);
  const lock = settings.indexOf("activeMeta && blockedByPlan(activeMeta) ? (");
  const wait = settings.indexOf(") : activeMeta?.feature && planLoading ? (");
  const first = settings.indexOf(') : view === "cache" ? (');
  assert.ok(lock > 0 && lock < wait && wait < first, "the lock card, then the wait, then any sub-view");
});

test("table, booking, waiter and marketplace popups never mount on the Billing plan; new orders still do", () => {
  const app = SRC("src/App.jsx");
  assert.match(app, /const tableService = !planPending && !billingOnly;/);
  for (const name of ["MarketplaceOrderPopup", "WaiterCallPopup", "TableBookingPopup", "AddedItemsPopup"]) {
    assert.match(app, new RegExp(`\\{tableService && <${name} />\\}`), `${name} must wait for the plan`);
    assert.equal((app.match(new RegExp(`<${name} />`, "g")) || []).length, 1, `${name} mounted once`);
  }
  assert.match(app, /\n\s*<NewOrderPopup \/>\n/);
  assert.match(app, /\n\s*<PrepDuePopup \/>\n/);
});

test("a call refused as not on the plan raises kk:plan-locked, and the app offers Billing at most every 10 s", () => {
  const ax = SRC("src/https/axiosWrapper.js");
  assert.match(ax, /error\.response\?\.status === 403 && error\.response\?\.data\?\.code === "PLAN_UPGRADE_REQUIRED"/);
  assert.match(ax, /window\.dispatchEvent\(new CustomEvent\("kk:plan-locked", \{ detail: error\.response\.data\.message \|\| "" \}\)\)/);
  // It does not retry or swallow the error: the screen still gets it.
  const branch = ax.slice(ax.indexOf('"PLAN_UPGRADE_REQUIRED"'), ax.indexOf("PIN_REQUIRED"));
  assert.doesNotMatch(branch, /return /);

  const app = SRC("src/App.jsx");
  const listener = app.slice(app.indexOf("const onPlanLocked"), app.indexOf("}, [enqueueSnackbar, navigate]);"));
  assert.ok(listener.length > 0, "listener missing");
  assert.ok(app.indexOf("}, [enqueueSnackbar, navigate]);") < app.indexOf("if (isLoading) return <FullScreenLoader />;"));
  assert.match(listener, /if \(Date\.now\(\) - planPromptAt\.current < 10_000\) return;/);
  assert.match(listener, /enqueueSnackbar\(e\.detail \|\| "Not on your plan\. Upgrade in Billing & Subscription\.", \{\s*variant: "warning",/);
  assert.match(listener, /onClick=\{\(\) => navigate\("\/settings\/billing"\)\}>Billing<\/button>/);
  assert.match(app, /window\.addEventListener\("kk:plan-locked", onPlanLocked\);/);
  assert.match(app, /return \(\) => window\.removeEventListener\("kk:plan-locked", onPlanLocked\);/);
  assert.match(app, /import \{ useSnackbar \} from "notistack";/);
});

test("Knot Eats' PLAN blocker links to Billing", () => {
  assert.match(SRC("src/components/settings/KnotEatsView.jsx"), /PLAN: "\/settings\/billing",/);
});
