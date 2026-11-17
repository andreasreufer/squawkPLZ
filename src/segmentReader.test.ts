import { describe, expect, it } from "vitest";
import {
  SEGMENT_TEMPLATES,
  SEGMENT_ZONES,
  classifySegments,
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
