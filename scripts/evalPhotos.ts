import { explainSquawk, findSquawk } from "../src/segmentReader";
import { greyed, loadLabels, loadPhoto } from "./photos";

/** Reads the squawk from every labeled photo at a few camera sample sizes. */
const SCALES = [960, 800, 640, 540];
const verbose = process.argv.includes("--verbose");
// --grey turns green text grey, to check that a standby squawk reads like an active one.
const grey = process.argv.includes("--grey");
let right = 0;
let total = 0;
for (const [name, label] of Object.entries(loadLabels())) {
  const results = SCALES.map((edge) => {
    const photo = loadPhoto(name, edge);
    const image = grey ? greyed(photo) : photo;
    const code = findSquawk(image).code;
    total += 1;
    if (code === label.squawk) right += 1;
    else if (verbose) console.log(`    ${edge}: ${explainSquawk(image).join(" | ")}`);
    return code === label.squawk ? "ok" : (code ?? "none");
  });
  console.log(`${name.padEnd(28)} ${label.squawk}  ${results.map((result) => result.padEnd(5)).join(" ")}`);
}
console.log(`\n${right} / ${total} readings match the label`);
