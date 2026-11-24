import { explainSquawk, findSquawk } from "../src/segmentReader";
import { loadLabels, loadPhoto } from "./photos";

/** Reads the squawk from every labeled photo at a few camera sample sizes. */
const SCALES = [960, 800, 640, 540];
const verbose = process.argv.includes("--verbose");
let right = 0;
let total = 0;
for (const [name, label] of Object.entries(loadLabels())) {
  const results = SCALES.map((edge) => {
    const image = loadPhoto(name, edge);
    const code = findSquawk(image).code;
    total += 1;
    if (code === label.squawk) right += 1;
    else if (verbose) console.log(`    ${edge}: ${explainSquawk(image).join(" | ")}`);
    return code === label.squawk ? "ok" : (code ?? "none");
  });
  console.log(`${name.padEnd(28)} ${label.squawk}  ${results.map((result) => result.padEnd(5)).join(" ")}`);
}
console.log(`\n${right} / ${total} readings match the label`);
