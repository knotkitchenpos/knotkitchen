/**
 * runAllTests.js
 * Runs the whole backend test suite and prints a short summary.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const testDir = path.join(__dirname, "..", "tests");
const files = fs.readdirSync(testDir).filter((f) => f.endsWith(".test.js"));

const result = spawnSync(
  process.execPath,
  ["--test", ...files.map((f) => path.join(testDir, f))],
  { encoding: "utf8" }
);

const output = `${result.stdout || ""}${result.stderr || ""}`;

const grab = (label) => {
  const m = output.match(new RegExp(`${label}\\s+(\\d+)`));
  return m ? Number(m[1]) : null;
};

const failing = output
  .split("\n")
  .filter((l) => /^not ok |^\u2716 /.test(l.trim()))
  .slice(0, 20);

console.log(`Test files: ${files.length}`);
console.log(`  tests:  ${grab("tests")}`);
console.log(`  pass:   ${grab("pass")}`);
console.log(`  fail:   ${grab("fail")}`);

if (failing.length) {
  console.log("\nFailing:");
  failing.forEach((l) => console.log(`  ${l.trim()}`));
}

process.exit(grab("fail") === 0 ? 0 : 1);
