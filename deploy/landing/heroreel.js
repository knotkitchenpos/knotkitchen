/* KnotKitchen hero: four real clips played as one 20 s story, with the
   KnotKitchen cards laid over them.
     1 cashier takes the order (order card fills in)
     2 the kitchen gets it      (KOT card)
     3 the waiter serves        (ready card)
     4 happy guests pay         (paid card, hearts)
   One clock drives everything. About a second before each cut the next clip
   is already rolling underneath, so the 1.4 s cross-fade blends two moving
   pictures instead of revealing a still frame; the outgoing clip keeps
   playing until it has faded out. The next clip is fetched only while the
   reel plays, so a visitor who never reaches the hero downloads one clip.
   Off screen or in a background tab it rests; with reduced motion it shows
   the first frame and its card, still. */
(() => {
  const reel = document.getElementById("reel");
  if (!reel) return;
  const vids = [...reel.querySelectorAll("video")];
  const steps = [...document.querySelectorAll(".scene-steps li")];
  const bar = document.querySelector(".scene-progress i");
  const SEG = 5; // seconds per clip
  const LEAD = 1.0; // the next clip starts rolling this long before its cut
  const FADE_MS = 1400; // keep in step with the .reel video transition in home.css
  const T = SEG * vids.length;
  const playing = !matchMedia("(prefers-reduced-motion: reduce)").matches;

  let visible = false;
  let elapsed = 0;
  let last = 0;
  let raf = 0;
  let step = -1;
  let primed = -1;

  const start = (v) => Number(v.dataset.start || 0);
  const warm = (v) => { if (v && v.preload !== "auto") { v.preload = "auto"; v.load(); } };
  // Put a clip at its first frame and set it rolling (or ready to roll).
  const cue = (v, roll) => {
    const go = () => {
      try { v.currentTime = start(v); } catch (e) { /* plays from 0 */ }
      v.playbackRate = Number(v.dataset.rate || 1);
      if (roll) v.play().catch(() => {});
    };
    warm(v);
    if (v.readyState >= 1) go(); else v.addEventListener("loadedmetadata", go, { once: true });
  };

  const show = (i) => {
    if (i === step) return;
    const prev = vids[step];
    step = i;
    const v = vids[i];
    // Reduced motion: the poster is the picture, so the clip is never fetched.
    if (!playing) {
      vids.forEach((el, k) => el.classList.toggle("on", k === i));
      reel.dataset.step = String(i);
      steps.forEach((li, k) => li.classList.toggle("on", k === i));
      return;
    }
    if (primed !== i) cue(v, visible);
    // a clip cued ahead can have been paused since (scrolled away, tab hidden): it must not fade in frozen
    else if (visible && v.paused) v.play().catch(() => {});
    primed = -1;
    vids.forEach((el, k) => el.classList.toggle("on", k === i));
    reel.dataset.step = String(i);
    steps.forEach((li, k) => li.classList.toggle("on", k === i));
    if (playing && visible) warm(vids[(i + 1) % vids.length]);
    if (prev && prev !== v) setTimeout(() => { if (!prev.classList.contains("on")) prev.pause(); }, FADE_MS + 200);
  };

  const tick = (now) => {
    // never backwards (a frame's timestamp can predate run()) and never a jump of more than 0.1 s
    elapsed = (elapsed + Math.max(0, Math.min(0.1, (now - last) / 1000))) % T;
    last = now;
    const i = Math.min(vids.length - 1, Math.max(0, Math.floor(elapsed / SEG)));
    show(i);
    const next = (i + 1) % vids.length;
    if (primed !== next && SEG - (elapsed % SEG) <= LEAD) { primed = next; cue(vids[next], true); }
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
  new IntersectionObserver((e) => {
    visible = e[0].isIntersecting;
    visible ? run() : halt();
  }, { threshold: 0.2 }).observe(reel);
  document.addEventListener("visibilitychange", () => (document.hidden ? halt() : run()));
})();
