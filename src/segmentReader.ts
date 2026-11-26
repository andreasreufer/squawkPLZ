import { GLYPH_MODEL } from "./glyphModel";

export const SEGMENT_TEMPLATES: readonly (readonly number[])[] = [
  [1, 1, 1, 0, 1, 1, 1],
  [0, 0, 1, 0, 0, 1, 0],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 0, 1, 1],
  [0, 1, 1, 1, 0, 1, 0],
  [1, 1, 0, 1, 0, 1, 1],
  [1, 1, 0, 1, 1, 1, 1],
  [1, 0, 1, 0, 0, 1, 0],
];

const EIGHT = [1, 1, 1, 1, 1, 1, 1];
const NINE = [1, 1, 1, 1, 0, 1, 1];

export type Zone = { x: number; y: number; w: number; h: number };

/** Fractions of one digit cell. Order: top, upper left, upper right, middle, lower left, lower right, bottom. */
export const SEGMENT_ZONES: readonly Zone[] = [
  { x: 0.22, y: 0.06, w: 0.56, h: 0.12 },
  { x: 0.08, y: 0.16, w: 0.16, h: 0.3 },
  { x: 0.76, y: 0.16, w: 0.16, h: 0.3 },
  { x: 0.22, y: 0.44, w: 0.56, h: 0.12 },
  { x: 0.08, y: 0.54, w: 0.16, h: 0.3 },
  { x: 0.76, y: 0.54, w: 0.16, h: 0.3 },
  { x: 0.22, y: 0.82, w: 0.56, h: 0.12 },
];

export type Raster = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type GuideReading = {
  digits: (number | null)[];
  code: string | null;
};

const LIT_FRACTION = 0.45;

export function classifySegments(bits: readonly number[]): number | null {
  if (bits.length !== 7) return null;

  let bestDigit = 0;
  let best = Number.POSITIVE_INFINITY;
  let second = Number.POSITIVE_INFINITY;

  SEGMENT_TEMPLATES.forEach((template, digit) => {
    const distance = hamming(bits, template);
    if (distance < best) {
      second = best;
      best = distance;
      bestDigit = digit;
    } else if (distance < second) {
      second = distance;
    }
  });

  const likeEight = hamming(bits, EIGHT);
  const likeNine = hamming(bits, NINE);
  const confident = best <= 1 && best < second && best < likeEight && best < likeNine;
  return confident ? bestDigit : null;
}

export function readGuide(image: Raster): GuideReading {
  if (image.width < 4 || image.height < 1 || image.data.length < image.width * image.height * 4) {
    return { digits: [null, null, null, null], code: null };
  }

  const gray = grayscale(image);
  const threshold = otsu(gray);
  let bright = 0;
  for (const value of gray) {
    if (value > threshold) bright += 1;
  }
  const litIsBright = bright / gray.length <= 0.5;
  const on = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    const value = gray[i] ?? 0;
    on[i] = (litIsBright ? value > threshold : value <= threshold) ? 1 : 0;
  }

  const cellWidth = image.width / 4;
  const digits = [0, 1, 2, 3].map((cell) =>
    classifySegments(sampleCell(on, image.width, image.height, cell * cellWidth, cellWidth)),
  );
  const code = digits.every((digit) => digit !== null) ? digits.join("") : null;
  return { digits, code };
}

const EMPTY_READING: GuideReading = { digits: [null, null, null, null], code: null };

/**
 * Finds the transponder code on a radio page.
 * The squawk is the lower group of exactly four green octal digits, or grey ones in standby. Anything after
 * that group on the same line is ignored, because the reply annunciator comes and goes.
 */
export function findSquawk(image: Raster): GuideReading {
  if (image.width < 8 || image.height < 8 || image.data.length < image.width * image.height * 4) {
    return EMPTY_READING;
  }

  const green = readTint(image, GREEN);
  // Grey is only read on a radio page, whose green frequencies give the text height and mark the rows to skip.
  const grey = green.lines.length > 0 && green.codes.length === 0 ? readTint(image, GREY, tallestBand(green.bands)) : null;
  // A standby squawk is grey, but so is a standby frequency, which shares its row with the green active one.
  const greyCodes = (grey?.codes ?? []).filter(
    (code) => !green.bands.some((band) => code.top >= band.top - 2 && code.top <= band.bottom),
  );
  // Plain ink is only a fallback for displays without colored text; on a radio page it finds labels and frames.
  const chosen =
    green.lines.length === 0
      ? lowestCode(codesInMask(inkMask(image), image.width, image.height))
      : (lowestCode(green.codes) ?? lowestCode(greyCodes));
  if (!chosen) return EMPTY_READING;
  return { digits: chosen.digits, code: chosen.digits.join("") };
}

export function explainSquawk(image: Raster): string[] {
  const green = readTint(image, GREEN);
  if (green.codes.length > 0 || green.lines.length === 0) return green.lines;
  return [...green.lines, ...readTint(image, GREY, tallestBand(green.bands)).lines.map((line) => `grey ${line}`)];
}

function tallestBand(bands: { top: number; bottom: number }[]): number {
  return Math.max(0, ...bands.map((band) => band.bottom - band.top + 1));
}

/** How one text color is told apart from the background. */
type Tint = {
  /** Loose test that finds the rows of text. */
  loose: (red: number, green: number, blue: number) => boolean;
  /** Stroke brightness, or 0 when the pixel is not this color. */
  strength: (red: number, green: number, blue: number) => number;
  /** Share of a row's width that must match for the row to hold text. */
  rowShare: number;
  /** Share of the brightest stroke that a pixel needs to count as ink. */
  coreShare: number;
};

const GREEN: Tint = {
  loose: (red, green, blue) => green >= 60 && green > red + 25 && green > blue + 10 && green > red * 1.35,
  strength: (red, green, blue) => (green > red + 18 && green > blue + 10 ? green : 0),
  rowShare: 0.006,
  coreShare: 0.45,
};

const GREY: Tint = {
  loose: (red, green, blue) => Math.min(red, green, blue) >= 110 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 40,
  strength: (red, green, blue) => (Math.max(red, green, blue) - Math.min(red, green, blue) <= 45 ? Math.min(red, green, blue) : 0),
  // The page frame is grey too, and its side lines touch every row.
  rowShare: 0.03,
  coreShare: 0.65,
};

function sampleCell(
  on: Uint8Array,
  width: number,
  height: number,
  originX: number,
  cellWidth: number,
): number[] {
  return SEGMENT_ZONES.map((zone) => {
    const x0 = clamp(Math.floor(originX + zone.x * cellWidth), 0, width);
    const y0 = clamp(Math.floor(zone.y * height), 0, height);
    const x1 = clamp(Math.ceil(originX + (zone.x + zone.w) * cellWidth), x0 + 1, width);
    const y1 = clamp(Math.ceil((zone.y + zone.h) * height), y0 + 1, height);
    let lit = 0;
    let total = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        total += 1;
        lit += on[y * width + x] ?? 0;
      }
    }
    return total > 0 && lit / total >= LIT_FRACTION ? 1 : 0;
  });
}

function grayscale(image: Raster): Uint8Array {
  const gray = new Uint8Array(image.width * image.height);
  const { data } = image;
  for (let pixel = 0, index = 0; pixel < gray.length; pixel += 1, index += 4) {
    const red = data[index] ?? 0;
    const green = data[index + 1] ?? 0;
    const blue = data[index + 2] ?? 0;
    gray[pixel] = (red * 77 + green * 150 + blue * 29) >> 8;
  }
  return gray;
}

function otsu(gray: Uint8Array): number {
  const histogram = new Uint32Array(256);
  for (const value of gray) histogram[value] += 1;
  const total = gray.length;
  let sum = 0;
  for (let tone = 0; tone < 256; tone += 1) sum += tone * (histogram[tone] ?? 0);

  let sumBackground = 0;
  let weightBackground = 0;
  let best = 0;
  let threshold = 127;

  for (let tone = 0; tone < 256; tone += 1) {
    weightBackground += histogram[tone] ?? 0;
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;
    sumBackground += tone * (histogram[tone] ?? 0);
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const between = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (between > best) {
      best = between;
      threshold = tone;
    }
  }

  return threshold;
}

function hamming(left: readonly number[], right: readonly number[]): number {
  let distance = 0;
  for (let i = 0; i < 7; i += 1) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) distance += 1;
  }
  return distance;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type FoundCode = { digits: number[]; top: number };

function lowestCode(codes: FoundCode[]): FoundCode | null {
  let best: FoundCode | null = null;
  for (const code of codes) {
    if (!best || code.top > best.top) best = code;
  }
  return best;
}

function readTint(
  image: Raster,
  tint: Tint,
  textHeight = 0,
): { codes: FoundCode[]; lines: string[]; bands: { top: number; bottom: number }[] } {
  const codes: FoundCode[] = [];
  const lines: string[] = [];
  const bands = tintBands(image, tint, textHeight);
  for (const band of bands) {
    const mask = strictBandMask(image, tint, band.top, band.bottom);
    const read = codesInBand(mask, image.width, band.top, band.bottom);
    lines.push(`${band.top}: ${read.text}`);
    codes.push(...read.codes);
  }
  return { codes, lines, bands };
}

/** Rows of text in one color that are tall enough to hold the squawk. */
function tintBands(image: Raster, tint: Tint, textHeight = 0): { top: number; bottom: number }[] {
  const bands = bandSpans(tintMask(image, tint), image.width, image.height, tint.rowShare);
  // Grey also covers glare and the bezel, so grey rows are sized against the green text when there is some.
  if (textHeight > 0) {
    return bands.filter((band) => band.bottom - band.top + 1 >= textHeight * 0.72 && band.bottom - band.top + 1 <= textHeight * 1.6);
  }
  let tallest = 0;
  for (const band of bands) tallest = Math.max(tallest, band.bottom - band.top + 1);
  return bands.filter((band) => band.bottom - band.top + 1 >= tallest * 0.72);
}

/** The glyph boxes of every green text line, for training and diagnostics. */
export function greenLines(image: Raster): GlyphLine[] {
  return tintBands(image, GREEN).map((band) =>
    lineBoxes(strictBandMask(image, GREEN, band.top, band.bottom), image.width, band.top, band.bottom),
  );
}

function bandSpans(mask: Uint8Array, width: number, height: number, rowShare = 0.006): { top: number; bottom: number }[] {
  const rowThreshold = Math.max(4, Math.floor(width * rowShare));
  const bands: { top: number; bottom: number }[] = [];
  let bandTop = -1;
  for (let y = 0; y <= height; y += 1) {
    let count = 0;
    if (y < height) {
      const start = y * width;
      for (let x = 0; x < width; x += 1) count += mask[start + x] ?? 0;
    }
    const active = y < height && count > rowThreshold;
    if (active && bandTop < 0) bandTop = y;
    if (!active && bandTop >= 0) {
      if (y - bandTop > 6) bands.push({ top: bandTop, bottom: y - 1 });
      bandTop = -1;
    }
  }
  return bands;
}

/**
 * Keeps the bright core of each stroke so camera bloom does not fuse neighboring digits.
 * The band is softened first, because a photo of an LCD shows its pixel grid as gaps through every stroke.
 */
function strictBandMask(image: Raster, tint: Tint, top: number, bottom: number): Uint8Array {
  const { width, height } = image;
  const radius = Math.max(1, Math.round((bottom - top + 1) / 30));
  const data = blurRows(image, top, bottom, radius);
  let peak = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      peak = Math.max(peak, tint.strength(data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0));
    }
  }
  const cut = Math.max(50, peak * tint.coreShare);
  const mask = new Uint8Array(width * height);
  for (let y = top; y <= bottom; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (tint.strength(data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0) >= cut) mask[row + x] = 1;
    }
  }
  // A frame line runs on above and below the text, and would otherwise read as a 1 beside the squawk.
  const reach = Math.max(2, Math.round((bottom - top + 1) / 3));
  const above = top - reach;
  const below = bottom + reach;
  if (above < 0 || below >= height) return mask;
  // The line leans a little in a photo, so it is looked for a few columns to either side.
  const lean = Math.max(1, Math.round(reach / 3));
  const inked = (x: number, y: number) => {
    for (let sx = Math.max(0, x - lean); sx <= Math.min(width - 1, x + lean); sx += 1) {
      const index = (y * width + sx) * 4;
      if (tint.loose(image.data[index] ?? 0, image.data[index + 1] ?? 0, image.data[index + 2] ?? 0)) return true;
    }
    return false;
  };
  for (let x = 0; x < width; x += 1) {
    if (!inked(x, above) || !inked(x, below)) continue;
    for (let y = top; y <= bottom; y += 1) mask[y * width + x] = 0;
  }
  return mask;
}

/** Box blur of the rows top..bottom; other rows are left empty. */
function blurRows(image: Raster, top: number, bottom: number, radius: number): Uint8ClampedArray {
  const { width, height, data } = image;
  const first = Math.max(0, top - radius);
  const last = Math.min(height - 1, bottom + radius);
  const across = new Float32Array(width * height * 3);
  for (let y = first; y <= last; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sx = x0; sx <= x1; sx += 1) {
        const index = (y * width + sx) * 4;
        red += data[index] ?? 0;
        green += data[index + 1] ?? 0;
        blue += data[index + 2] ?? 0;
      }
      const count = x1 - x0 + 1;
      const out = (y * width + x) * 3;
      across[out] = red / count;
      across[out + 1] = green / count;
      across[out + 2] = blue / count;
    }
  }
  const blurred = new Uint8ClampedArray(width * height * 4);
  for (let y = top; y <= bottom; y += 1) {
    const y0 = Math.max(first, y - radius);
    const y1 = Math.min(last, y + radius);
    for (let x = 0; x < width; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sy = y0; sy <= y1; sy += 1) {
        const index = (sy * width + x) * 3;
        red += across[index] ?? 0;
        green += across[index + 1] ?? 0;
        blue += across[index + 2] ?? 0;
      }
      const count = y1 - y0 + 1;
      const out = (y * width + x) * 4;
      blurred[out] = red / count;
      blurred[out + 1] = green / count;
      blurred[out + 2] = blue / count;
    }
  }
  return blurred;
}

function tintMask(image: Raster, tint: Tint): Uint8Array {
  const mask = new Uint8Array(image.width * image.height);
  const { data } = image;
  for (let pixel = 0, index = 0; pixel < mask.length; pixel += 1, index += 4) {
    if (tint.loose(data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0)) mask[pixel] = 1;
  }
  return mask;
}

function inkMask(image: Raster): Uint8Array {
  const gray = grayscale(image);
  const threshold = otsu(gray);
  let bright = 0;
  for (const value of gray) {
    if (value > threshold) bright += 1;
  }
  const litIsBright = bright / gray.length <= 0.5;
  const mask = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    const value = gray[i] ?? 0;
    mask[i] = (litIsBright ? value > threshold : value <= threshold) ? 1 : 0;
  }
  return mask;
}

function codesInMask(mask: Uint8Array, width: number, height: number): FoundCode[] {
  const found: FoundCode[] = [];
  for (const band of bandSpans(mask, width, height)) {
    found.push(...codesInBand(mask, width, band.top, band.bottom).codes);
  }
  return found;
}

export type GlyphBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** A decimal point. */
  dot: boolean;
  /** Too short or too wide to be a digit, so it closes any run of digits. */
  breaksRun: boolean;
  glyph: Binary;
};

export type GlyphLine = { top: number; bottom: number; boxes: GlyphBox[]; typicalWidth: number; glyphHeight: number };

/** Splits one text line into glyph boxes from left to right. */
export function lineBoxes(mask: Uint8Array, width: number, top: number, bottom: number): GlyphLine {
  const bandHeight = bottom - top + 1;
  const columns = new Uint16Array(width);
  for (let y = top; y <= bottom; y += 1) {
    const start = y * width;
    for (let x = 0; x < width; x += 1) columns[x] = (columns[x] ?? 0) + (mask[start + x] ?? 0);
  }

  const columnThreshold = Math.max(1, Math.floor(bandHeight * 0.12));
  const spans: { left: number; right: number }[] = [];
  let spanLeft = -1;
  for (let x = 0; x <= width; x += 1) {
    const active = x < width && (columns[x] ?? 0) > columnThreshold;
    if (active && spanLeft < 0) spanLeft = x;
    if (!active && spanLeft >= 0) {
      if (x - spanLeft >= 2) spans.push({ left: spanLeft, right: x - 1 });
      spanLeft = -1;
    }
  }

  type Bounds = { left: number; right: number; top: number; bottom: number; dot: boolean };
  const bounds: Bounds[] = [];
  for (const span of spans) {
    let left = span.right;
    let right = span.left;
    let boxTop = bottom;
    let boxBottom = top;
    let any = false;
    for (let y = top; y <= bottom; y += 1) {
      const start = y * width;
      for (let x = span.left; x <= span.right; x += 1) {
        if (!mask[start + x]) continue;
        any = true;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < boxTop) boxTop = y;
        if (y > boxBottom) boxBottom = y;
      }
    }
    if (!any) continue;
    const boxHeight = boxBottom - boxTop + 1;
    const boxWidth = right - left + 1;
    const center = (boxTop + boxBottom) / 2;
    const dot = boxHeight < bandHeight * 0.55 && center > top + bandHeight * 0.55;
    const speck = !dot && boxHeight < bandHeight * 0.4 && boxWidth < bandHeight * 0.35;
    if (speck) continue;
    bounds.push({ left, right, top: boxTop, bottom: boxBottom, dot });
  }

  mergeSerifs(bounds, bandHeight);
  const typicalWidth = median(bounds.filter((box) => !box.dot).map((box) => box.right - box.left + 1));
  // Glare can make the band taller than its text, so digits are judged against their neighbors.
  const glyphHeight =
    median(bounds.map((box) => box.bottom - box.top + 1).filter((boxHeight) => boxHeight >= bandHeight * 0.5)) ||
    bandHeight;
  const boxes = bounds.map((box): GlyphBox => {
    const boxWidth = box.right - box.left + 1;
    const boxHeight = box.bottom - box.top + 1;
    const breaksRun = box.dot || boxHeight < glyphHeight * 0.75 || boxWidth > glyphHeight * 1.7;
    const glyph = crop(mask, width, box);
    return { ...box, breaksRun, glyph };
  });
  return { top, bottom, boxes, typicalWidth, glyphHeight };
}

/** Joins a stray foot or flag back onto the tall glyph it almost touches; a real decimal point sits farther off. */
function mergeSerifs(
  bounds: { left: number; right: number; top: number; bottom: number; dot: boolean }[],
  bandHeight: number,
): void {
  const reach = Math.max(1, Math.round(bandHeight * 0.08));
  const tall = (box: { top: number; bottom: number }) => box.bottom - box.top + 1 >= bandHeight * 0.62;
  for (let index = 0; index < bounds.length; index += 1) {
    const box = bounds[index];
    if (!box || tall(box)) continue;
    const before = bounds[index - 1];
    const after = bounds[index + 1];
    const host =
      before && tall(before) && box.left - before.right - 1 <= reach
        ? before
        : after && tall(after) && after.left - box.right - 1 <= reach
          ? after
          : null;
    if (!host) continue;
    host.left = Math.min(host.left, box.left);
    host.right = Math.max(host.right, box.right);
    host.top = Math.min(host.top, box.top);
    host.bottom = Math.max(host.bottom, box.bottom);
    bounds.splice(index, 1);
    index -= 1;
  }
}

function codesInBand(
  mask: Uint8Array,
  width: number,
  top: number,
  bottom: number,
): { codes: FoundCode[]; text: string } {
  const { boxes, typicalWidth, glyphHeight } = lineBoxes(mask, width, top, bottom);
  const found: FoundCode[] = [];
  const symbols: string[] = [];
  let run: number[] = [];
  let poisoned = false;
  let previousRight = -1;

  let runBoxes: GlyphBox[] = [];
  const flush = () => {
    if (!poisoned && run.length === 4 && evenlySpaced(runBoxes, run, glyphHeight)) found.push({ digits: run.slice(), top });
    run = [];
    runBoxes = [];
    poisoned = false;
  };

  for (const box of boxes) {
    const gap = previousRight < 0 ? 0 : box.left - previousRight - 1;
    previousRight = box.right;
    if (box.breaksRun) {
      symbols.push(box.dot ? "." : "-");
      if (run.length === 4 && !poisoned) {
        flush();
        break;
      }
      flush();
      continue;
    }
    const digit = classifyGlyph(box.glyph);
    symbols.push(digit === null ? "?" : digit > 7 ? "X" : String(digit));
    if (run.length === 4 && !poisoned) {
      const closeDigit = digit !== null && gap <= Math.max(2, typicalWidth * 0.7);
      if (!closeDigit) {
        flush();
        break;
      }
      poisoned = true;
      run = [];
      continue;
    }
    if (digit === null || digit > 7) {
      flush();
      continue;
    }
    if (poisoned) continue;
    run.push(digit);
    runBoxes.push(box);
  }
  flush();
  return { codes: found, text: symbols.join("") };
}

/**
 * The digits of one code sit on a monospace grid; frame lines and stray marks do not.
 * A one may sit anywhere in its cell, so the grid is measured on the other digits when there are two.
 */
function evenlySpaced(boxes: GlyphBox[], digits: number[], glyphHeight: number): boolean {
  const centers = boxes.map((box) => (box.left + box.right) / 2);
  let anchors = digits.flatMap((digit, index) => (digit === 1 ? [] : [index]));
  if (anchors.length < 2) anchors = digits.map((_, index) => index);
  const pitches = anchors
    .slice(1)
    .map((index, step) => {
      const previous = anchors[step] ?? 0;
      return ((centers[index] ?? 0) - (centers[previous] ?? 0)) / (index - previous);
    });
  if (pitches.length === 0) return false;
  const widest = Math.max(...pitches);
  const narrowest = Math.min(...pitches);
  if (widest > glyphHeight * 1.2 || widest > narrowest * 1.5) return false;
  const pitch = pitches.reduce((sum, value) => sum + value, 0) / pitches.length;
  const origin = anchors[0] ?? 0;
  return centers.every(
    (center, index) => Math.abs(center - (centers[origin] ?? 0) - (index - origin) * pitch) <= pitch * 0.45,
  );
}

function crop(
  mask: Uint8Array,
  width: number,
  box: { left: number; right: number; top: number; bottom: number },
): Binary {
  const boxWidth = box.right - box.left + 1;
  const boxHeight = box.bottom - box.top + 1;
  const data = new Uint8Array(boxWidth * boxHeight);
  for (let y = 0; y < boxHeight; y += 1) {
    const source = (box.top + y) * width + box.left;
    data.set(mask.subarray(source, source + boxWidth), y * boxWidth);
  }
  return { width: boxWidth, height: boxHeight, data };
}

export type Binary = { width: number; height: number; data: Uint8Array };

/**
 * Reads one digit glyph by its nearest neighbour in the trained glyph model.
 * Returns null when the glyph is far from every example or two digits are about as close.
 */
export function classifyGlyph(glyph: Binary): number | null {
  if (glyph.width < 2 || glyph.height < 6) return null;
  const features = glyphFeatures(glyph);
  let best = Number.POSITIVE_INFINITY;
  let bestDigit = -1;
  let rival = Number.POSITIVE_INFINITY;
  for (const sample of MODEL_SAMPLES) {
    const distance = featureDistance(features, sample.features);
    if (distance < best) {
      if (sample.digit !== bestDigit) rival = best;
      best = distance;
      bestDigit = sample.digit;
    } else if (sample.digit !== bestDigit && distance < rival) {
      rival = distance;
    }
  }
  if (bestDigit < 0 || best > GLYPH_MODEL.maxDistance) return null;
  if (rival < best * GLYPH_MODEL.minRivalRatio) return null;
  return bestDigit;
}

/** Glyph shape as ink density on a coarse grid, plus its aspect ratio. */
export function glyphFeatures(glyph: Binary): number[] {
  const { columns, rows } = GLYPH_MODEL;
  const features: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      features.push(density(glyph, column / columns, row / rows, (column + 1) / columns, (row + 1) / rows));
    }
  }
  features.push(glyph.width / glyph.height);
  return features;
}

export function featureDistance(left: readonly number[], right: readonly number[]): number {
  const cells = left.length - 1;
  let sum = 0;
  for (let i = 0; i < cells; i += 1) sum += ((left[i] ?? 0) - (right[i] ?? 0)) ** 2;
  const aspect = (left[cells] ?? 0) - (right[cells] ?? 0);
  return Math.sqrt(sum / cells + GLYPH_MODEL.aspectWeight * aspect * aspect);
}

const MODEL_SAMPLES = GLYPH_MODEL.samples.map(([digit, cells, aspect]) => ({
  digit,
  features: [...Array.from(cells, (level) => Number(level) / 9), aspect],
}));

function density(glyph: Binary, x0: number, y0: number, x1: number, y1: number): number {
  const left = clamp(Math.floor(x0 * glyph.width), 0, glyph.width);
  const right = clamp(Math.max(left + 1, Math.ceil(x1 * glyph.width)), left + 1, glyph.width);
  const top = clamp(Math.floor(y0 * glyph.height), 0, glyph.height);
  const bottom = clamp(Math.max(top + 1, Math.ceil(y1 * glyph.height)), top + 1, glyph.height);
  let lit = 0;
  let total = 0;
  for (let y = top; y < bottom; y += 1) {
    const start = y * glyph.width;
    for (let x = left; x < right; x += 1) {
      total += 1;
      lit += glyph.data[start + x] ?? 0;
    }
  }
  return total > 0 ? lit / total : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
