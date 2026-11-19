import { useEffect } from "react";

/** The restaurant's alert ringtone, looped while anything needs attention. */
// ?v=: the file is replaced in place, so tills must not keep playing a cached old tone.
export const ALERT_TONE_URL = "/sounds/alert-ringtone.mp3?v=2";

/*
 * One audio element for the whole till. A new order, added items and a waiter
 * call can all be outstanding at once; three copies of the ringtone started a
 * second apart are noise, not three alerts. Each active hook takes a share and
 * the tone stops when the last one lets go.
 */
let tone = null;
let holders = 0;

const getTone = () => {
  if (typeof Audio === "undefined") return null;
  if (!tone) {
    tone = new Audio(ALERT_TONE_URL);
    tone.loop = true;
    tone.preload = "auto";
  }
  return tone;
};

/**
 * The ringtone, on a loop, until the operator deals with something. The
 * ringtone is the only alert sound: the old synthesised beep is gone.
 *
 * A browser blocks sound on a page nobody has touched yet (a POS tab opened
 * from CSD, say); the first tap or keypress anywhere starts the ringtone.
 *
 * @param {boolean} active  sound while true, stop the moment it goes false
 */
export default function useAlertBeep(active) {
  useEffect(() => {
    if (!active) return undefined;

    const playTone = () => {
      const el = getTone();
      // Still ringing, or let go before this ran: nothing to start.
      if (!el || !el.paused || holders === 0) return;
      el.play().then(
        () => {
          // Accepted while the play was starting: stop, don't ring on.
          if (holders === 0) {
            el.pause();
            el.currentTime = 0;
          }
        },
        () => {
          /* blocked until the page is touched; unlock below retries */
        },
      );
    };

    holders += 1;
    playTone();

    const unlock = () => playTone();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    return () => {
      holders = Math.max(0, holders - 1);
      if (holders === 0 && tone) {
        tone.pause();
        tone.currentTime = 0;
      }
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [active]);
}
