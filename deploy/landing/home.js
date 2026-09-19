/* KnotKitchen landing page motion. No libraries; everything is optional:
   with JavaScript off the page reads the same, just still. */
(() => {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

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

  /* ---- the till leans towards the pointer ---- */
  const stage = $(".stage");
  const till = $(".till");
  if (stage && till && matchMedia("(hover: hover)").matches) {
    stage.addEventListener("pointermove", (e) => {
      const b = stage.getBoundingClientRect();
      const x = (e.clientX - b.left) / b.width - 0.5;
      const y = (e.clientY - b.top) / b.height - 0.5;
      till.style.setProperty("--ry", `${x * 14}deg`);
      till.style.setProperty("--rx", `${-y * 10}deg`);
    });
    stage.addEventListener("pointerleave", () => {
      till.style.removeProperty("--ry");
      till.style.removeProperty("--rx");
    });
  }

  /* ---- a soft light follows the pointer across feature cards ---- */
  $$(".tile").forEach((t) =>
    t.addEventListener("pointermove", (e) => {
      const b = t.getBoundingClientRect();
      t.style.setProperty("--mx", `${e.clientX - b.left}px`);
      t.style.setProperty("--my", `${e.clientY - b.top}px`);
    }),
  );

  /* ---- "how it works": the line fills as the section scrolls through ---- */
  const track = $(".track");
  if (track) {
    const fill = () => {
      const b = track.getBoundingClientRect();
      const p = (innerHeight * 0.8 - b.top) / (b.height + innerHeight * 0.3);
      track.style.setProperty("--p", Math.max(0, Math.min(1, p)).toFixed(3));
    };
    addEventListener("scroll", fill, { passive: true });
    addEventListener("resize", fill);
    fill();
  }
})();
