import { useEffect, useState } from "react";

/**
 * True once `key` has been on screen for `ms`.
 *
 * A live alert opens wherever the till's next tap is about to land, and the
 * next queued card opens in the same spot the moment the last one is decided,
 * so a double tap used to accept two orders. Action handlers check this and
 * swallow taps until the card has been visible long enough to be read.
 *
 * Armed only for the key it timed: a new card (new key) is disarmed on its
 * very first frame, with no window where the old timer's `true` leaks through.
 */
export default function useArmed(key, ms = 500) {
  const [armedFor, setArmedFor] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => setArmedFor(key), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return armedFor === key;
}
