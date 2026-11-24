import { inflateSync } from "node:zlib";
import type { Raster } from "../src/segmentReader";

export function decodePng(bytes: Buffer): Raster {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let color = 0;
  const parts: Buffer[] = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      color = chunk[9] ?? 0;
    } else if (type === "IDAT") parts.push(chunk);
    else if (type === "IEND") break;
  }
  const bpp = color === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(parts));
  const data = new Uint8ClampedArray(width * height * 4);
  let source = 0;
  const prior = Buffer.alloc(stride);
  const row = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source] ?? 0;
    source += 1;
    raw.copy(row, 0, source, source + stride);
    source += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? (row[x - bpp] ?? 0) : 0;
      const up = prior[x] ?? 0;
      const upLeft = x >= bpp ? (prior[x - bpp] ?? 0) : 0;
      if (filter === 1) row[x] = ((row[x] ?? 0) + left) & 255;
      else if (filter === 2) row[x] = ((row[x] ?? 0) + up) & 255;
      else if (filter === 3) row[x] = ((row[x] ?? 0) + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) row[x] = ((row[x] ?? 0) + paeth(left, up, upLeft)) & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 4;
      const sample = x * bpp;
      data[pixel] = row[sample] ?? 0;
      data[pixel + 1] = row[sample + 1] ?? 0;
      data[pixel + 2] = row[sample + 2] ?? 0;
      data[pixel + 3] = 255;
    }
    row.copy(prior);
  }
  return { width, height, data };
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const diagonal = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= diagonal) return left;
  if (upDistance <= diagonal) return up;
  return upLeft;
}
