import fs from "node:fs/promises";
import path from "node:path";

const beforeDir = path.resolve(process.argv[2] || "artifacts/studio-before");
const afterDir = path.resolve(process.argv[3] || "artifacts/studio-after");
const before = JSON.parse(await fs.readFile(path.join(beforeDir, "metrics.json"), "utf8"));
const after = JSON.parse(await fs.readFile(path.join(afterDir, "metrics.json"), "utf8"));
const failures = [];
let checked = 0;

// Subpixel rounding and equivalent color serializations must not fail a
// compiler migration. Layout drift over 1px and any changed style token do.
function compare(previous, candidate, location) {
  if (typeof previous === "number") {
    checked++;
    if (typeof candidate !== "number" || Math.abs(previous - candidate) > 1) failures.push({ location, before: previous, after: candidate });
    return;
  }
  if (previous && typeof previous === "object") {
    const oldKeys = Object.keys(previous);
    const newKeys = Object.keys(candidate || {});
    if (oldKeys.join() !== newKeys.join()) failures.push({ location, reason: "Campos de comparação diferentes", before: oldKeys, after: newKeys });
    for (const key of oldKeys) compare(previous[key], candidate?.[key], `${location}.${key}`);
    return;
  }
  checked++;
  if (previous !== candidate) failures.push({ location, before: previous, after: candidate });
}

compare(before, after, "studio");
for (const [name, values] of Object.entries(after)) {
  if (values.overflow > 1) failures.push({ location: name, reason: "Overflow horizontal", after: values.overflow });
}
const report = { passed: failures.length === 0, checked, tolerancePxOrColorChannel: 1, failures };
await fs.writeFile(path.join(afterDir, "comparison.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
