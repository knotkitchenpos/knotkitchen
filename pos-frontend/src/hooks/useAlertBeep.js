import { useEffect, useRef } from "react";

/**
 * A repeating alert tone that runs until the operator deals with something.
 *
 * Synthesised with WebAudio rather than played from an audio file: a till that
 * is offline, or a deployment that forgets to ship the asset, would otherwise
 * fail silently — and a notification nobody hears is the whole problem this
 * exists to solve.
 *
 * Browsers refuse to start audio until the page has been interacted with. A
 * POS is a page someone is constantly touching, so in practice the context is
 * already unlocked; if it is not, we resume it on the first interaction rather
 * than throwing.
 *
 * @param {boolean} active  beep while true, stop the moment it goes false
 * @param {object}  [opts]
 * @param {number}  [opts.intervalMs=1600]  gap between beeps
 * @param {number}  [opts.frequency=880]    tone in Hz
 */
export default function useAlertBeep(active, { intervalMs = 1600, frequency = 880 } = {}) {
  const ctxRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;

    const getCtx = () => {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      if (!ctxRef.current || ctxRef.current.state === "closed") {
        try {
          ctxRef.current = new Ctor();
        } catch {
          return null;
        }
      }
      return ctxRef.current;
    };

    /** One short two-tone chirp — carries across a noisy room. */
    const chirp = () => {
      const ctx = getCtx();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});

      const now = ctx.currentTime;
      [0, 0.18].forEach((offset, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = i === 0 ? frequency : frequency * 1.25;
        // Ramped rather than switched, so it doesn't click.
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.32, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.15);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.16);
      });
    };

    chirp();
    timerRef.current = setInterval(chirp, intervalMs);

    // If audio was blocked because nothing had been clicked yet, the first
    // interaction anywhere unlocks it.
    const unlock = () => {
      const ctx = getCtx();
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    return () => {
      clearInterval(timerRef.current);
      timerRef.current = null;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [active, intervalMs, frequency]);

  // Release the audio device when the component using this goes away.
  useEffect(
    () => () => {
      clearInterval(timerRef.current);
      if (ctxRef.current && ctxRef.current.state !== "closed") {
        ctxRef.current.close().catch(() => {});
      }
      ctxRef.current = null;
    },
    [],
  );
}
