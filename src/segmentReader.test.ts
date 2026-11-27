import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import {
  SEGMENT_TEMPLATES,
  SEGMENT_ZONES,
  classifySegments,
  findSquawk,
  readGuide,
  type Raster,
} from "./segmentReader";

const EIGHT = [1, 1, 1, 1, 1, 1, 1];
const NINE = [1, 1, 1, 1, 0, 1, 1];

describe("classifySegments", () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7])("reads template %i", (digit) => {
    expect(classifySegments(SEGMENT_TEMPLATES[digit] ?? [])).toBe(digit);
  });

  it("rejects an 8-like pattern and a 9-like pattern", () => {
    expect(classifySegments(EIGHT)).toBeNull();
    expect(classifySegments(NINE)).toBeNull();
  });

  it("rejects a blank cell and a tie", () => {
    expect(classifySegments([0, 0, 0, 0, 0, 0, 0])).toBeNull();
    expect(classifySegments([1, 1, 1, 1, 1, 1, 0])).toBeNull();
  });
});

describe("readGuide", () => {
  it("reads 0123 and 4567 from bright segments on black", () => {
    expect(readGuide(renderDigits([0, 1, 2, 3], false)).code).toBe("0123");
    expect(readGuide(renderDigits([4, 5, 6, 7], false)).code).toBe("4567");
  });

  it("reads dark segments on a light card", () => {
    expect(readGuide(renderDigits([0, 1, 2, 3], true)).code).toBe("0123");
  });

  it("leaves an 8-like cell uncertain and does not lock a code", () => {
    const reading = readGuide(renderPattern([SEGMENT_TEMPLATES[0] ?? [], SEGMENT_TEMPLATES[1] ?? [], EIGHT, SEGMENT_TEMPLATES[7] ?? []], false));
    expect(reading.digits).toEqual([0, 1, null, 7]);
    expect(reading.code).toBeNull();
  });
});

describe("findSquawk", () => {
  it("reads four classic digits that fill the frame", () => {
    expect(findSquawk(renderDigits([4, 5, 6, 7], false)).code).toBe("4567");
    expect(findSquawk(renderDigits([0, 1, 2, 3], true)).code).toBe("0123");
  });

  it("reads the green XPDR code and ignores frequencies and cyan digits", () => {
    expect(findSquawk(renderRadioPage()).code).toBe("2000");
  });

  it("keeps the squawk when extra digits sit to the right with a gap", () => {
    expect(findSquawk(renderGreenRows([{ digits: [2, 0, 0, 0], x: 24 }, { digits: [7, 1, 2, 3], x: 24 + 4 * 64 + 90 }])).code).toBe("2000");
  });

  it("does not take the first four digits of a longer number", () => {
    expect(findSquawk(renderGreenRows([{ digits: [2, 0, 0, 0, 3, 2], x: 24 }])).code).toBeNull();
  });

  it("reads squawk 2000 from a photo of the radio page", () => {
    const photo = decodePng(
      readFileSync(new URL("./fixtures/xpdr-2000.png", import.meta.url)),
    );
    expect(findSquawk(photo).code).toBe("2000");
  });

  it.each([
    ["xpdr-4567.png", "4567"],
    ["xpdr-7654.png", "7654"],
  ])("reads the LCD font through screen moire in %s", (fixture, code) => {
    const photo = decodePng(readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url)));
    expect(findSquawk(photo).code).toBe(code);
  });

  it("reads a grey squawk filling the guide beside the screen frame", () => {
    const photo = decodePng(readFileSync(new URL("./fixtures/guide-4567-grey.png", import.meta.url)));
    expect(findSquawk(photo).code).toBe("4567");
  });

  it("reads a grey standby squawk beside its white frame", () => {
    const photo = decodePng(readFileSync(new URL("./fixtures/xpdr-0123-grey.png", import.meta.url)));
    expect(findSquawk(photo).code).toBe("0123");
  });
});

function renderDigits(digits: number[], invert: boolean): Raster {
  const patterns = digits.map((digit) => {
    if (digit === 8) return EIGHT;
    if (digit === 9) return NINE;
    return SEGMENT_TEMPLATES[digit] ?? EIGHT;
  });
  return renderPattern(patterns, invert);
}

function renderPattern(patterns: readonly (readonly number[])[], invert: boolean): Raster {
  const width = 240;
  const height = 80;
  const data = new Uint8ClampedArray(width * height * 4);
  const background = invert ? 255 : 0;
  const ink = invert ? 0 : 255;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = background;
    data[i + 1] = background;
    data[i + 2] = background;
    data[i + 3] = 255;
  }
  const cellWidth = width / 4;
  patterns.forEach((bits, cell) => {
    SEGMENT_ZONES.forEach((zone, segment) => {
      if (!bits[segment]) return;
      const x0 = Math.floor(cell * cellWidth + zone.x * cellWidth);
      const y0 = Math.floor(zone.y * height);
      const x1 = Math.ceil(cell * cellWidth + (zone.x + zone.w) * cellWidth);
      const y1 = Math.ceil((zone.y + zone.h) * height);
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const offset = (y * width + x) * 4;
          data[offset] = ink;
          data[offset + 1] = ink;
          data[offset + 2] = ink;
        }
      }
    });
  });
  return { width, height, data };
}

const EIGHT_BITS = [1, 1, 1, 1, 1, 1, 1];

function renderRadioPage(): Raster {
  const width = 980;
  const height = 420;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 8;
    data[i + 1] = 10;
    data[i + 2] = 8;
    data[i + 3] = 255;
  }
  const green: [number, number, number] = [18, 176, 52];
  const cyan: [number, number, number] = [0, 160, 186];
  const drawDigit = (digit: number, x: number, y: number, color: [number, number, number]) => {
    const bits = digit === 8 ? EIGHT_BITS : (SEGMENT_TEMPLATES[digit] ?? EIGHT_BITS);
    const cellWidth = 56;
    const cellHeight = 84;
    SEGMENT_ZONES.forEach((zone, segment) => {
      if (!bits[segment]) return;
      const x0 = Math.floor(x + zone.x * cellWidth);
      const y0 = Math.floor(y + zone.y * cellHeight);
      const x1 = Math.ceil(x + (zone.x + zone.w) * cellWidth);
      const y1 = Math.ceil(y + (zone.y + zone.h) * cellHeight);
      for (let py = y0; py < y1; py += 1) {
        for (let px = x0; px < x1; px += 1) {
          const offset = (py * width + px) * 4;
          data[offset] = color[0];
          data[offset + 1] = color[1];
          data[offset + 2] = color[2];
        }
      }
    });
  };
  const drawDot = (x: number, y: number, color: [number, number, number]) => {
    for (let py = y + 70; py < y + 80; py += 1) {
      for (let px = x + 8; px < x + 18; px += 1) {
        const offset = (py * width + px) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
      }
    }
  };
  const drawRow = (digits: readonly (number | "dot")[], x: number, y: number, color: [number, number, number]) => {
    digits.forEach((glyph, index) => {
      const origin = x + index * 64;
      if (glyph === "dot") drawDot(origin, y, color);
      else drawDigit(glyph, origin, y, color);
    });
  };
  drawRow([1, 2, 2, "dot", 8, 0, 0], 24, 24, green);
  drawRow([1, 1, 8, "dot", 0, 0, 0], 500, 24, cyan);
  drawRow([1, 0, 8, "dot", 0, 0], 24, 156, green);
  drawRow([2, 0, 0, 0], 24, 288, green);
  return { width, height, data };
}

function renderGreenRows(rows: { digits: number[]; x: number }[]): Raster {
  const width = 900;
  const height = 140;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 8;
    data[i + 1] = 10;
    data[i + 2] = 8;
    data[i + 3] = 255;
  }
  const cellWidth = 56;
  const cellHeight = 84;
  for (const row of rows) {
    row.digits.forEach((digit, index) => {
      const bits = SEGMENT_TEMPLATES[digit] ?? EIGHT_BITS;
      const origin = row.x + index * 64;
      SEGMENT_ZONES.forEach((zone, segment) => {
        if (!bits[segment]) return;
        const x0 = Math.floor(origin + zone.x * cellWidth);
        const y0 = Math.floor(28 + zone.y * cellHeight);
        const x1 = Math.ceil(origin + (zone.x + zone.w) * cellWidth);
        const y1 = Math.ceil(28 + (zone.y + zone.h) * cellHeight);
        for (let py = y0; py < y1; py += 1) {
          for (let px = x0; px < x1; px += 1) {
            const offset = (py * width + px) * 4;
            data[offset] = 18;
            data[offset + 1] = 176;
            data[offset + 2] = 52;
          }
        }
      });
    });
  }
  return { width, height, data };
}

function decodePng(bytes: Buffer): Raster {
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
    } else if (type === "IDAT") {
      parts.push(chunk);
    } else if (type === "IEND") {
      break;
    }
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
