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
  const rupees = (n) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const el = (tag, props, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };
  // Only a picture uploaded in CSD (the server checks the same when it is saved).
  const picture = (url) => (/^https:\/\/api\.knotkitchen\.com\/uploads\/platform\/devices\/[0-9a-f-]+\.webp$/.test(url || "") ? url : "");
  // Billing is on the owner's Partners dashboard: sign in there, then its Billing opens this
  // device's request (pos-frontend Billing.jsx, ?device=, kept through the sign-in).
  const orderUrl = (code) => `https://knotkitchen.com/partners/billing?device=${encodeURIComponent(code)}`;
  const dialog = $("#device-dialog");
  const showDevice = (d) => {
    const src = picture(d.imageUrl);
    $("#dd-media").replaceChildren(...(src ? [el("img", { src, alt: d.name, width: 640, height: 480 })] : []));
    $("#dd-name").textContent = d.name;
    $("#dd-price").textContent = `${rupees(d.price)} incl. GST, one time`;
    $("#dd-desc").textContent = d.description;
    $("#dd-order").href = orderUrl(d.code);
    $("#dd-demo").href = "https://wa.me/919477623682?text=" +
      encodeURIComponent(`Hi KnotKitchen, I'd like a free demo and the ${d.name} (${rupees(d.price)}).\n*Restaurant name:* \n*City:* `);
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
    // A plan's limited-time offer note ("Regular price ₹699"): gone once the catalogue price reaches it.
    $$("[data-offer]").forEach((e) => {
      const price = plan(e.dataset.offer).price;
      const regular = Number(((e.querySelector && e.querySelector("[data-price]")) || {}).textContent?.replace(/[^\d.]/g, ""));
      if (Number.isFinite(price) && Number.isFinite(regular) && price >= regular) e.hidden = true;
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

  /* ---- header: glass once the page has scrolled, and a thin reading-progress line ---- */
  const header = $("header");
  const bar = $(".progress");
  const onHeader = () => {
    const y = scrollY;
    if (header) header.classList.toggle("scrolled", y > 8);
    const max = document.documentElement.scrollHeight - innerHeight;
    if (bar) bar.style.setProperty("--read", max > 0 ? Math.min(1, y / max).toFixed(4) : "0");
  };
  addEventListener("scroll", perFrame(onHeader), { passive: true });
  onHeader();

  if (still) return;
  document.documentElement.classList.add("motion");

  /* ---- looping animations rest while their section is off screen ---- */
  const rest = new IntersectionObserver((entries) =>
    entries.forEach((e) => e.target.classList.toggle("offscreen", !e.isIntersecting)),
  );
  $$(".kk-hero, .marquee, .bento, .kk-close, .plan-card.featured").forEach((n) => rest.observe(n));

  /* ---- section headings: each word rises out of its own mask ---- */
  $$(".kk-head h2, .kk-close h2").forEach((h) => {
    let n = 0;
    const walk = (node) => [...node.childNodes].forEach((c) => {
      if (c.nodeType === 3) {
        const frag = document.createDocumentFragment();
        c.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) return frag.append(part);
          const w = el("span", { className: "w" }, el("span", { textContent: part }));
          w.style.setProperty("--wi", n++);
          frag.append(w);
        });
        c.replaceWith(frag);
      } else if (c.nodeType === 1 && c.tagName !== "BR") walk(c);
    });
    walk(h);
    h.classList.add("split-words");
  });

  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  // The box is measured once on entry: measuring a tilted card on every move would feed the tilt back into itself.
  const follow = (node, onMove, onLeave) => {
    let box = null;
    node.addEventListener("pointerenter", () => { box = node.getBoundingClientRect(); });
    node.addEventListener("pointermove", perFrame((e) => {
      if (!box) return;
      onMove((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height, e.clientX - box.left, e.clientY - box.top);
    }));
    node.addEventListener("pointerleave", () => { box = null; onLeave(); });
  };
  const put = (node, vars) => Object.entries(vars).forEach(([k, v]) => node.style.setProperty(k, v));

  if (fine) {
    /* ---- cards tilt towards the pointer, and a soft light follows it ---- */
    $$("[data-tilt]").forEach((t) => follow(t,
      (x, y, px, py) => put(t, { "--tx": (x - 0.5).toFixed(3), "--ty": (y - 0.5).toFixed(3), "--mx": `${px}px`, "--my": `${py}px` }),
      () => put(t, { "--tx": "0", "--ty": "0" })));

    /* ---- buttons lean towards the pointer ---- */
    $$(".magnet").forEach((b) => follow(b,
      (x, y) => put(b, { "--gx": `${((x - 0.5) * 12).toFixed(1)}px`, "--gy": `${((y - 0.5) * 10).toFixed(1)}px` }),
      () => put(b, { "--gx": "0px", "--gy": "0px" })));

    /* ---- the closing card's floating moments drift against the pointer ---- */
    const close = $(".kk-close");
    if (close) follow(close,
      (x, y) => put(close, { "--cx": (x - 0.5).toFixed(3), "--cy": (y - 0.5).toFixed(3) }),
      () => put(close, { "--cx": "0", "--cy": "0" }));
  }

  /* ---- scroll-linked depth: section lights, the app showcase and the "how it works" line ---- */
  const pars = $$("[data-par]");
  const stage = $("[data-stage]");
  const track = $(".track");
  const stops = $$(".stop");
  const wide = matchMedia("(min-width: 1001px)");
  const onScroll = () => {
    const vh = innerHeight;
    pars.forEach((s) => {
      const b = s.getBoundingClientRect();
      if (b.bottom < -200 || b.top > vh + 200) return;
      s.style.setProperty("--py", ((b.top + b.height / 2 - vh / 2) / vh).toFixed(3));
    });
    if (stage) {
      const b = stage.getBoundingClientRect();
      stage.style.setProperty("--p", Math.max(0, Math.min(1, (vh - b.top) / (vh * 0.75))).toFixed(3));
    }
    if (track) {
      const b = track.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (vh * 0.8 - b.top) / (b.height + vh * 0.3)));
      put(track, { "--p": p.toFixed(3), "--track-w": `${b.width}px` });
      stops.forEach((s, i) => s.classList.toggle("lit",
        wide.matches ? p >= (i + 0.15) / stops.length : s.getBoundingClientRect().top < vh * 0.72));
    }
  };
  addEventListener("scroll", perFrame(onScroll), { passive: true });
  addEventListener("resize", perFrame(onScroll));
  onScroll();
})();
