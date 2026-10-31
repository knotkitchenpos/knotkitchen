/**
 * Capitalisation as the menu is typed (owner, 2026-10-31): names of
 * products, categories, groups and components in Capitalized Case
 * ("Paneer Tikka Pizza"), descriptions in Sentence case.
 *
 * Only the letter just typed changes, and only at the start of a word (or of
 * a sentence): the rest stays as typed, so "BBQ" or "iPhone-style" survive.
 * Pasted text is left as it is. The owner can always have it otherwise:
 * backspace over a capital and type a small letter in its place, and the
 * small letter stays.
 */

const isLower = (ch) => ch !== ch.toUpperCase() && ch === ch.toLowerCase();

/** Does a word ("title") or a sentence ("sentence") start at `i`? */
export const startsAt = (text, i, mode) => {
  if (mode === "title") return i === 0 || /[\s(/&-]/.test(text[i - 1]);
  let j = i - 1;
  while (j >= 0 && text[j] === " ") j -= 1;
  return j < 0 || /[.!?\n]/.test(text[j]);
};

/** The one character typed or deleted between `prev` and `next`, or null. */
const singleEdit = (prev, next) => {
  const diff = next.length - prev.length;
  if (Math.abs(diff) !== 1) return null;
  let i = 0;
  while (i < prev.length && i < next.length && prev[i] === next[i]) i += 1;
  const [long, short] = diff > 0 ? [next, prev] : [prev, next];
  if (long.slice(0, i) + long.slice(i + 1) !== short) return null;
  return { at: i, inserted: diff > 0, ch: long[i] };
};

/**
 * `next` as it should be after one keystroke turned `prev` into it. `keepAt`
 * is where the owner just backspaced a capital away: a small letter typed
 * there stays small. Returns { value, keepAt } for the next keystroke.
 */
export const applyAutoCase = (prev, next, mode, keepAt = null) => {
  const edit = singleEdit(prev, next);
  if (!edit) return { value: next, keepAt: null };
  if (!edit.inserted) {
    const capitalRemoved = edit.ch !== edit.ch.toLowerCase() && startsAt(prev, edit.at, mode);
    return { value: next, keepAt: capitalRemoved ? edit.at : null };
  }
  if (keepAt === edit.at || !isLower(edit.ch) || !startsAt(next, edit.at, mode)) return { value: next, keepAt: null };
  return { value: next.slice(0, edit.at) + edit.ch.toUpperCase() + next.slice(edit.at + 1), keepAt: null };
};

// Per field: where its owner last backspaced a capital away.
const keepAtFor = new WeakMap();

/**
 * onChange for a menu text field, in place of (e) => setValue(e.target.value):
 *
 *   <input value={name} onChange={autoCase("title", name, setName)} autoCapitalize="words" />
 */
export const autoCase = (mode, current, setValue) => (e) => {
  const el = e.target;
  const { value, keepAt } = applyAutoCase(String(current ?? ""), el.value, mode, keepAtFor.get(el) ?? null);
  keepAtFor.set(el, keepAt);
  if (value !== el.value) {
    // Changed in the field itself first, caret kept, so React does not move it to the end.
    const caret = el.selectionStart;
    el.value = value;
    el.setSelectionRange?.(caret, caret);
  }
  setValue(value);
};
