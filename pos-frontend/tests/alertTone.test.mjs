import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const HOOK = fs.readFileSync(new URL("../src/hooks/useAlertBeep.js", import.meta.url), "utf8");

test("the ringtone is the only alert sound: no synthesised beep left", () => {
  assert.doesNotMatch(HOOK, /AudioContext|createOscillator|setInterval/);
  assert.match(HOOK, /\/sounds\/alert-ringtone\.mp3/);
});

test("a ringtone that starts after the alert was cleared stops at once", () => {
  assert.match(HOOK, /if \(holders === 0\) \{\s*el\.pause\(\);/);
});
