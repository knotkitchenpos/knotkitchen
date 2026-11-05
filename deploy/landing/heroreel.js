/* KnotKitchen hero: four real clips played as one 20 s story, with the
   KnotKitchen cards laid over them.
     1 cashier takes the order (order card fills in)
     2 the kitchen gets it      (KOT card prints)
     3 the waiter serves        (served card)
     4 happy guests pay         (paid card, hearts)
   One clock drives everything: the clips cross-fade on its beat, the cards
   follow data-step on the reel, the bar shows its progress. The next clip is
   fetched only when the one before it starts, so a visitor who never scrolls
   to the hero, or leaves early, downloads one clip, not four. Reduced motion:
   the first frame and its card, standing still, until Play is pressed. */
(() => {
  const reel = document.getElementById("reel");
  if (!reel) return;
  const vids = [...reel.querySelectorAll("video")];
  const steps = [...document.querySelectorAll(".scene-steps li")];
  const toggle = document.querySelector(".scene-toggle");
  const bar = document.querySelector(".scene-progress i");
  const SEG = 5; // seconds per clip
  const T = SEG * vids.length;
  const start = (v) => Number(v.dataset.start || 0);
  const rate = (v) => Number(v.dataset.rate || 1);

  let playing = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  let visible = false;
  let elapsed = 0;
  let last = 0;
  let raf = 0;
  let step = -1;

  const warm = (v) => { if (v && v.preload !== "auto") { v.preload = "auto"; v.load(); } };
  const show = (i) => {
    if (i === step) return;
    const prev = vids[step];
    step = i;
    const v = vids[i];
    vids.forEach((el, k) => el.classList.toggle("on", k === i));
    reel.dataset.step = String(i);
    steps.forEach((li, k) => li.classList.toggle("on", k === i));
    warm(v);
    // a clip that was never fetched cannot seek yet: seek once it knows its length
    const seek = () => { try { v.currentTime = start(v); } catch (e) { /* plays from 0 */ } };
    if (v.readyState >= 1) seek(); else v.addEventListener("loadedmetadata", seek, { once: true });
    v.playbackRate = rate(v);
    if (playing && visible) {
      v.play().catch(() => {});
      warm(vids[(i + 1) % vids.length]); // fetch the next clip only while the reel actually plays
    }
    if (prev && prev !== v) setTimeout(() => prev.pause(), 700);
  };

  const tick = (now) => {
    // a throttled or background tab must not skip a whole step: at most 0.1 s per frame
    // and never backwards: a frame's timestamp can be a little older than the performance.now() run() took
    elapsed = (elapsed + Math.max(0, Math.min(0.1, (now - last) / 1000))) % T;
    last = now;
    show(Math.min(vids.length - 1, Math.max(0, Math.floor(elapsed / SEG))));
    if (bar) bar.style.transform = `scaleX(${(elapsed / T).toFixed(4)})`;
    raf = requestAnimationFrame(tick);
  };
  const run = () => {
    if (raf || !playing || !visible) return;
    last = performance.now();
    const v = vids[step];
    if (v) v.play().catch(() => {});
    warm(vids[(step + 1) % vids.length]);
    raf = requestAnimationFrame(tick);
  };
  const halt = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    vids.forEach((v) => v.pause());
  };

  show(0);
  reel.classList.add("ready");
  if (toggle) {
    const label = () => {
      toggle.setAttribute("aria-pressed", String(!playing));
      toggle.setAttribute("aria-label", playing ? "Pause video" : "Play video");
      toggle.dataset.state = playing ? "playing" : "paused";
    };
    label();
    toggle.addEventListener("click", () => {
      playing = !playing;
      label();
      playing ? run() : halt();
    });
  }
  new IntersectionObserver((e) => {
    visible = e[0].isIntersecting;
    visible ? run() : halt();
  }, { threshold: 0.2 }).observe(reel);
  document.addEventListener("visibilitychange", () => (document.hidden ? halt() : run()));
})();
