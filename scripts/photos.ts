import { readFileSync } from "node:fs";
import { join } from "node:path";
import jpeg from "jpeg-js";
import type { Raster } from "../src/segmentReader";
import { decodePng } from "./png";

export const TRAINING_DIR = new URL("../training_data/", import.meta.url).pathname;

export type Label = { squawk: string; lines: string[] };

export function loadLabels(): Record<string, Label> {
  return JSON.parse(readFileSync(join(TRAINING_DIR, "labels.json"), "utf8")) as Record<string, Label>;
}

/** Loads a training photo scaled so its longer edge is at most `edge`, like a camera sample. */
export function loadPhoto(name: string, edge: number): Raster {
  const bytes = readFileSync(join(TRAINING_DIR, name));
  const image = /\.png$/i.test(name)
    ? decodePng(bytes)
    : (() => {
        const decoded = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 1024 });
        return { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) };
      })();
  return shrink(image, edge);
}

/** Box-filter downscale, close to what a canvas does when it draws a video frame smaller. */
function shrink(image: Raster, edge: number): Raster {
  const scale = edge / Math.max(image.width, image.height);
  if (scale >= 1) return image;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor((y * image.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor((x * image.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * image.width) / width));
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const index = (sy * image.width + sx) * 4;
          red += image.data[index] ?? 0;
          green += image.data[index + 1] ?? 0;
          blue += image.data[index + 2] ?? 0;
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      const out = (y * width + x) * 4;
      data[out] = red / count;
      data[out + 1] = green / count;
      data[out + 2] = blue / count;
      data[out + 3] = 255;
    }
  }
  return { width, height, data };
}
