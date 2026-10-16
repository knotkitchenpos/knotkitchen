/* KnotKitchen landing page: today's prices from the API, and motion. No
   libraries; everything is optional: with JavaScript off the page reads the
   same, just still and with the prices written into the HTML (the "no-js"
   class on <html> keeps every reveal visible until this file actually runs). */
(() => {
  document.documentElement.classList.remove("no-js");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  /* ---- the phone menu closes once one of its links is chosen ---- */
  const menu = $(".menu");
  if (menu) menu.addEventListener("click", (e) => { if (e.target.closest("a")) menu.open = false; });

  /* ---- phones: the pricing fine print starts folded (open without script, and when printing) ---- */
  if (matchMedia("(max-width:700px)").matches) $$(".plan-notes details").forEach((d) => (d.open = false));
  addEventListener("beforeprint", () => $$(".plan-notes details").forEach((d) => (d.open = true)));

  /* ---- prices, add-ons and devices from the catalogue CSD edits (GET /api/public/pricing).
     The HTML already shows them, so a failed or slow request leaves the page as it is.
     Before the reduced-motion return below: everyone gets today's prices. ---- */
  const POS_APP = "https://business.knotkitchen.com";
  const rupees = (n) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const el = (tag, props, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };
  // Only a picture uploaded in CSD (the server checks the same when it is saved).
  const picture = (url) => (/^https:\/\/api\.knotkitchen\.com\/uploads\/platform\/devices\/[0-9a-f-]+\.webp$/.test(url || "") ? url : "");
  // Sign in first; POS Billing then opens this device's request (pos-frontend Billing.jsx, ?device=).
  const orderUrl = (code) => `${POS_APP}/settings/billing?device=${encodeURIComponent(code)}`;
  const dialog = $("#device-dialog");
  const showDevice = (d) => {
    const src = picture(d.imageUrl);
    $("#dd-media").replaceChildren(...(src ? [el("img", { src, alt: d.name, width: 640, height: 480 })] : []));
    $("#dd-name").textContent = d.name;
    $("#dd-price").textContent = `${rupees(d.price)} incl. GST, one time`;
    $("#dd-desc").textContent = d.description;
    $("#dd-order").href = orderUrl(d.code);
    $("#dd-demo").href = "https://wa.me/918062177510?text=" +
      encodeURIComponent(`Hi KnotKitchen, I'd like a demo and the ${d.name} (${rupees(d.price)}). Restaurant name:  City: `);
    dialog.showModal();
  };
  const deviceCard = (d) => {
    const src = picture(d.imageUrl);
    const view = el("button", { type: "button", className: "dev-view" },
      ...(src ? [el("img", { src: `${src}?w=640`, alt: "", width: 320, height: 240, loading: "lazy", className: "dev-img" })] : []),
      el("b", { textContent: d.name }));
    if (dialog && dialog.showModal) view.addEventListener("click", () => showDevice(d));
    return el("li", {}, view, el("span", { textContent: d.description }),
      el("em", { textContent: rupees(d.price) }, el("small", { textContent: "incl. GST, one time" })),
      el("a", { className: "btn", href: orderUrl(d.code), textContent: "Order" }));
  };
  const showPricing = (p) => {
    const plan = (code) => p.plans.find((x) => x.code === code) || {};
    $$("[data-price]").forEach((e) => {
      const [kind, code, field = "price"] = e.dataset.price.split(":");
      const v = kind === "plan" ? plan(code)[field] : kind === "charge" ? (p.charges || {})[code] : undefined;
      if (Number.isFinite(v)) e.textContent = rupees(v);
    });
    $$("[data-gst]").forEach((e) => { e.hidden = (p.taxable || {})[e.dataset.gst.split(":")[1]] === false; });
    if (Number.isFinite(p.periodDays)) $$("[data-period]").forEach((e) => { e.textContent = p.periodDays; });
    const addons = $("#addon-list");
    if (addons) {
      addons.replaceChildren(...p.addons.map((a) => el("li", {},
        el("div", {}, el("b", { textContent: a.name }), el("span", { textContent: a.description })),
        el("em", { textContent: rupees(a.price) }, el("small", { textContent: `+ GST / ${a.periodDays === 365 ? "year" : `${a.periodDays} days`}` })))));
    }
    const devices = $("#device-list");
    if (devices) {
      devices.className = "devices";
      devices.replaceChildren(...(p.devices.length ? p.devices.map(deviceCard) : [el("li", { textContent: "No devices are on sale at the moment." })]));
    }
    // What search engines read: the POS plan's offer.
    const ld = $('script[type="application/ld+json"]');
    const pos = plan("POS");
    if (ld && Number.isFinite(pos.price)) {
      const data = JSON.parse(ld.textContent);
      const offer = (data["@graph"] || []).map((g) => g.offers).find(Boolean);
      if (offer) {
        offer.price = String(pos.price);
        offer.description = `POS plan: ${rupees(pos.price)} + GST per ${p.periodDays} days, prepaid from the KnotKitchen wallet`;
        ld.textContent = JSON.stringify(data);
      }
    }
  };
  const giveUp = new AbortController();
  setTimeout(() => giveUp.abort(), 4000);
  fetch("https://api.knotkitchen.com/api/public/pricing", { signal: giveUp.signal })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((body) => {
      const p = body && body.data;
      if (p && [p.plans, p.addons, p.devices].every(Array.isArray)) showPricing(p);
    })
    .catch(() => {}); // the prices in the HTML stay

  /* ---- reveal on scroll ---- */
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))),
    { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
  );
  $$(".reveal").forEach((el) => io.observe(el));

  /* ---- the till: an order being taken, sent, served and paid, on a loop ---- */
  const rows = $$(".rows li");
  const total = $("#till-total");
  const status = $("#till-status");
  const money = (n) => "₹ " + n.toLocaleString("en-IN");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const setStatus = (label, cls = "") => {
    status.textContent = label;
    status.className = "status " + cls;
  };
  const countTo = async (from, to) => {
    for (let i = 1; i <= 12; i++) {
      total.textContent = money(Math.round(from + ((to - from) * i) / 12));
      await wait(28);
    }
  };
  const runTill = async () => {
    for (;;) {
      let sum = 0;
      rows.forEach((r) => r.classList.remove("on"));
      total.textContent = money(0);
      setStatus("New order");
      await wait(700);
      for (const r of rows) {
        r.classList.add("on");
        await countTo(sum, (sum += Number(r.dataset.amt)));
        await wait(520);
      }
      setStatus("Preparing");
      await wait(1900);
      setStatus("Ready", "ready");
      await wait(1700);
      setStatus("Paid · UPI", "paid");
      await wait(2400);
    }
  };
  if (rows.length && total && status) {
    if (still) {
      rows.forEach((r) => r.classList.add("on"));
    } else {
      runTill();
    }
  }

  if (still) return;

  /* ---- looping animations rest while their section is off screen ---- */
  const rest = new IntersectionObserver((entries) =>
    entries.forEach((e) => e.target.classList.toggle("offscreen", !e.isIntersecting)),
  );
  $$(".kk-hero, .marquee, .bento, .kk-close").forEach((el) => rest.observe(el));

  // One write per frame, however many pointer or scroll events arrive.
  const perFrame = (fn) => {
    let queued = false;
    let last;
    return (e) => {
      last = e;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        fn(last);
      });
    };
  };

  /* ---- the till leans towards the pointer ---- */
  const stage = $(".stage");
  const till = $(".till");
  if (stage && till && matchMedia("(hover: hover)").matches) {
    stage.addEventListener("pointermove", perFrame((e) => {
      const b = stage.getBoundingClientRect();
      const x = (e.clientX - b.left) / b.width - 0.5;
      const y = (e.clientY - b.top) / b.height - 0.5;
      till.style.setProperty("--ry", `${x * 14}deg`);
      till.style.setProperty("--rx", `${-y * 10}deg`);
    }));
    stage.addEventListener("pointerleave", () => {
      till.style.removeProperty("--ry");
      till.style.removeProperty("--rx");
    });
  }

  /* ---- a soft light follows the pointer across feature cards ---- */
  $$(".tile").forEach((t) =>
    t.addEventListener("pointermove", perFrame((e) => {
      const b = t.getBoundingClientRect();
      t.style.setProperty("--mx", `${e.clientX - b.left}px`);
      t.style.setProperty("--my", `${e.clientY - b.top}px`);
    })),
  );

  /* ---- "how it works": the line fills as the section scrolls through ---- */
  const track = $(".track");
  if (track) {
    const fill = () => {
      const b = track.getBoundingClientRect();
      const p = (innerHeight * 0.8 - b.top) / (b.height + innerHeight * 0.3);
      track.style.setProperty("--p", Math.max(0, Math.min(1, p)).toFixed(3));
    };
    addEventListener("scroll", perFrame(fill), { passive: true });
    addEventListener("resize", perFrame(fill));
    fill();
  }
})();
