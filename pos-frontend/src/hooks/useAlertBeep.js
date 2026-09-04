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
 * @param {number}  [opts.intervalMs=900]  gap between bursts
 * @param {number}  [opts.frequency=988]   first tone in Hz
 */
export default function useAlertBeep(active, { intervalMs = 900, frequency = 988 } = {}) {
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

    /**
     * A three-pulse rising burst.
     *
     * This was two soft sine tones a second and a half apart, which reads as
     * a notification chime rather than something demanding attention -- easy
     * to miss over a busy counter. Three things changed:
     *
     *   - a square wave, whose harmonics cut through kitchen noise where a
     *     pure sine gets absorbed;
     *   - three quick pulses on a RISING pitch, which the ear reads as an
     *     alarm rather than a chime;
     *   - a shorter gap between bursts, so it nags.
     *
     * Still ramped rather than switched, or each pulse ends in a click.
     */
    const chirp = () => {
      const ctx = getCtx();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});

      const now = ctx.currentTime;
      const steps = [
        { at: 0.00, hz: frequency },
        { at: 0.13, hz: frequency * 1.335 },
        { at: 0.26, hz: frequency * 1.587 },
      ];

      steps.forEach(({ at, hz }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = hz;
        gain.gain.setValueAtTime(0.0001, now + at);
        gain.gain.exponentialRampToValueAtTime(0.22, now + at + 0.008);
        gain.gain.setValueAtTime(0.22, now + at + 0.075);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.11);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + at);
        osc.stop(now + at + 0.12);
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
