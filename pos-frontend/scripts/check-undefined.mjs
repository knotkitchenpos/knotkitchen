/**
 * Fail on `no-undef` only.
 *
 * `vite build` uses esbuild, which does no scope analysis — a variable that is
 * never bound compiles perfectly and throws ReferenceError the moment the code
 * runs. That is how `dayIndex` shipped: the Timings & Holidays settings page
 * crashed on render while CI stayed green.
 *
 * A full `npm run lint` gate would be better, but the tree still carries
 * unrelated style errors, so this narrows the gate to the one rule that maps
 * directly onto a runtime crash. Widen it once the backlog is clear.
 */
import { ESLint } from "eslint";

const eslint = new ESLint();
const results = await eslint.lintFiles(["src"]);

const undef = results.flatMap((r) =>
  r.messages
    .filter((m) => m.ruleId === "no-undef")
    .map((m) => `${r.filePath}:${m.line}:${m.column}  ${m.message}`)
);

if (undef.length) {
  console.error(`Found ${undef.length} undefined reference(s) — each one is a runtime crash:\n`);
  for (const line of undef) console.error(`  ${line}`);
  console.error("\nBind the variable (a missing map param or import is the usual cause).");
  process.exit(1);
}

console.log("No undefined references in src/.");
