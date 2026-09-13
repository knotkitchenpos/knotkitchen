import { useEffect, useRef } from "react";

/** The restaurant's alert ringtone, looped while anything needs attention. */
export const ALERT_TONE_URL = "/sounds/alert-ringtone.mp3";

/*
 * One audio element for the whole till. A new order, added items and a waiter
 * call can all be outstanding at once; three copies of the ringtone started a
 * second apart are noise, not three alerts. Each active hook takes a share and
 * the tone stops when the last one lets go.
 */
let tone = null;
let holders = 0;
let toneBroken = false;

const getTone = () => {
  if (toneBroken || typeof Audio === "undefined") return null;
  if (!tone) {
    tone = new Audio(ALERT_TONE_URL);
    tone.loop = true;
    tone.preload = "auto";
    tone.addEventListener("error", () => {
      toneBroken = true;
    });
  }
  return tone;
};

/**
 * A repeating alert that runs until the operator deals with something.
 *
 * Plays the ringtone on a loop. Two things can stop a file from sounding, and
 * a notification nobody hears is the whole problem this exists to solve, so
 * each falls back to a synthesised WebAudio burst:
 *
 *   - the asset fails to load (offline till, a deployment missing the file);
 *   - the browser blocks playback because the page has not been touched yet.
 *     The first tap or keypress anywhere retries the ringtone.
 *
 * @param {boolean} active  sound while true, stop the moment it goes false
 * @param {object}  [opts]
 * @param {number}  [opts.intervalMs=900]  gap between fallback bursts
 * @param {number}  [opts.frequency=988]   first fallback tone in Hz
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

    // Three quick square-wave pulses on a rising pitch: reads as an alarm
    // over kitchen noise. Ramped, or each pulse ends in a click.
    const chirp = () => {
      const ctx = getCtx();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});

      const now = ctx.currentTime;
      const steps = [
        { at: 0.0, hz: frequency },
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

    const startFallback = () => {
      if (timerRef.current) return;
      chirp();
      timerRef.current = setInterval(chirp, intervalMs);
    };

    const stopFallback = () => {
      clearInterval(timerRef.current);
      timerRef.current = null;
    };

    const playTone = () => {
      const el = getTone();
      if (!el) return startFallback();
      if (!el.paused) return stopFallback();
      el.play().then(stopFallback, startFallback);
    };

    holders += 1;
    playTone();

    // A broken file flips to the synth; a blocked one is retried on the first
    // interaction, which also unlocks the fallback's audio context.
    const unlock = () => {
      const ctx = ctxRef.current;
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
      playTone();
    };
    const onToneError = () => startFallback();
    tone?.addEventListener("error", onToneError);
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    return () => {
      stopFallback();
      holders = Math.max(0, holders - 1);
      if (holders === 0 && tone) {
        tone.pause();
        tone.currentTime = 0;
      }
      tone?.removeEventListener("error", onToneError);
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
