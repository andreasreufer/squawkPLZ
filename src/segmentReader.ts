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
 * The squawk is the lower group of exactly four green octal digits. Anything after
 * that group on the same line is ignored, because the reply annunciator comes and goes.
 */
export function findSquawk(image: Raster): GuideReading {
  if (image.width < 8 || image.height < 8 || image.data.length < image.width * image.height * 4) {
    return EMPTY_READING;
  }

  const green = lowestCode(readGreen(image).codes);
  const chosen = green ?? lowestCode(codesInMask(inkMask(image), image.width, image.height));
  if (!chosen) return EMPTY_READING;
  return { digits: chosen.digits, code: chosen.digits.join("") };
}

export function explainSquawk(image: Raster): string[] {
  return readGreen(image).lines;
}

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

function readGreen(image: Raster): { codes: FoundCode[]; lines: string[] } {
  const loose = greenMask(image);
  const bands = bandSpans(loose, image.width, image.height);
  let tallest = 0;
  for (const band of bands) tallest = Math.max(tallest, band.bottom - band.top + 1);
  const codes: FoundCode[] = [];
  const lines: string[] = [];
  for (const band of bands) {
    const bandHeight = band.bottom - band.top + 1;
    if (tallest > 0 && bandHeight < tallest * 0.72) continue;
    const mask = strictBandMask(image, band.top, band.bottom);
    const read = codesInBand(mask, image.width, band.top, band.bottom);
    lines.push(`${band.top}: ${read.text}`);
    codes.push(...read.codes);
  }
  return { codes, lines };
}

function bandSpans(mask: Uint8Array, width: number, height: number): { top: number; bottom: number }[] {
  const rowThreshold = Math.max(4, Math.floor(width * 0.006));
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

/** Keeps the bright core of each stroke so camera bloom does not fuse neighboring digits. */
function strictBandMask(image: Raster, top: number, bottom: number): Uint8Array {
  const { width, height, data } = image;
  let peak = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      if (green >= 45 && green > red + 15 && green > blue + 8 && green > peak) peak = green;
    }
  }
  const cut = Math.max(50, peak * 0.45);
  const mask = new Uint8Array(width * height);
  for (let y = top; y <= bottom; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      if (green >= cut && green > red + 18 && green > blue + 10) mask[row + x] = 1;
    }
  }
  return mask;
}

function greenMask(image: Raster): Uint8Array {
  const mask = new Uint8Array(image.width * image.height);
  const { data } = image;
  for (let pixel = 0, index = 0; pixel < mask.length; pixel += 1, index += 4) {
    const red = data[index] ?? 0;
    const green = data[index + 1] ?? 0;
    const blue = data[index + 2] ?? 0;
    if (green >= 60 && green > red + 25 && green > blue + 10 && green > red * 1.35) mask[pixel] = 1;
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

function codesInBand(
  mask: Uint8Array,
  width: number,
  top: number,
  bottom: number,
): { codes: FoundCode[]; text: string } {
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

  type Box = { left: number; right: number; top: number; bottom: number; dot: boolean };
  const boxes: Box[] = [];
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
    boxes.push({ left, right, top: boxTop, bottom: boxBottom, dot });
  }

  const fullWidths = boxes.filter((box) => !box.dot).map((box) => box.right - box.left + 1);
  const typical = median(fullWidths);
  const found: FoundCode[] = [];
  const symbols: string[] = [];
  let run: number[] = [];
  let poisoned = false;
  let previousRight = -1;

  const flush = () => {
    if (!poisoned && run.length === 4) found.push({ digits: run.slice(), top });
    run = [];
    poisoned = false;
  };

  for (const box of boxes) {
    const gap = previousRight < 0 ? 0 : box.left - previousRight - 1;
    previousRight = box.right;
    const boxWidth = box.right - box.left + 1;
    const boxHeight = box.bottom - box.top + 1;
    const endsTheCode = box.dot || boxHeight < bandHeight * 0.62 || boxWidth > bandHeight * 1.7;
    if (endsTheCode) {
      symbols.push(box.dot ? "." : "-");
      if (run.length === 4 && !poisoned) {
        flush();
        break;
      }
      flush();
      continue;
    }
    const glyph = crop(mask, width, box);
    const aspect = boxWidth / boxHeight;
    const narrowerThanNeighbors = typical > 0 && boxWidth < typical * 0.8;
    const looksLikeOne =
      boxHeight > bandHeight * 0.65 &&
      (aspect < 0.5 || (aspect < 0.6 && narrowerThanNeighbors)) &&
      countHoles(glyph) === 0;
    const digit = looksLikeOne ? 1 : classifyGlyph(glyph);
    symbols.push(digit === null ? "?" : digit > 7 ? "X" : String(digit));
    if (run.length === 4 && !poisoned) {
      const closeDigit = digit !== null && digit <= 7 && gap <= Math.max(2, typical * 0.7);
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
  }
  flush();
  return { codes: found, text: symbols.join("") };
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

type Binary = { width: number; height: number; data: Uint8Array };

function classifyGlyph(glyph: Binary): number | null {
  const { width, height } = glyph;
  if (width < 2 || height < 6) return null;
  const aspect = width / height;
  const holes = countHoles(glyph);
  const top = density(glyph, 0.22, 0, 0.78, 0.22);
  const bottom = density(glyph, 0.22, 0.78, 0.78, 1);
  const middle = density(glyph, 0.3, 0.4, 0.7, 0.6);
  const upperLeft = density(glyph, 0, 0.15, 0.42, 0.48);
  const upperRight = density(glyph, 0.58, 0.15, 1, 0.48);
  const lowerLeft = density(glyph, 0, 0.52, 0.42, 0.85);
  const lowerRight = density(glyph, 0.58, 0.52, 1, 0.85);

  if (aspect < 0.5 && holes === 0) return 1;
  const balanced = Math.min(upperLeft, upperRight, lowerLeft, lowerRight);
  const openLowerRight =
    lowerRight + 0.18 < lowerLeft &&
    lowerRight < 0.42 &&
    upperRight > 0.4 &&
    top > 0.45 &&
    bottom > 0.45 &&
    middle < 0.8;
  if (openLowerRight && holes <= 1) return 2;
  if (holes >= 2) {
    if (middle < 0.4 && balanced > 0.28 && top > 0.35 && bottom > 0.35) return 0;
    return 8;
  }
  if (holes === 1 && middle < 0.55 && balanced > 0.28) return 0;
  if (holes === 1 && upperRight < 0.45 && lowerLeft > 0.35 && lowerRight > 0.3) return 6;
  if (holes === 1 && lowerLeft < 0.35 && upperRight > 0.4 && upperLeft < 0.4 && middle > 0.45) return 3;
  if (holes === 1 && lowerLeft < 0.45 && upperRight > 0.35 && upperLeft > 0.3) return 9;
  if (middle < 0.4 && top > 0.4 && bottom > 0.4 && balanced > 0.25) return 0;
  if (top > 0.5 && bottom < 0.42 && upperLeft < 0.35 && upperRight > 0.3 && lowerLeft < 0.5) return 7;
  if (middle > 0.4 && bottom < 0.4 && top < 0.4 && upperLeft > 0.25 && lowerRight > 0.25 && lowerLeft < 0.4) {
    return 4;
  }
  if (top > 0.4 && bottom > 0.4 && middle > 0.35 && lowerRight + 0.12 < lowerLeft && lowerRight < 0.65 && upperRight > 0.35) {
    return 2;
  }
  if (top > 0.4 && bottom > 0.4 && middle > 0.35 && upperRight + 0.12 < upperLeft && lowerLeft < 0.45 && lowerRight > 0.3) {
    return 5;
  }
  if (
    top > 0.4 &&
    bottom > 0.4 &&
    middle > 0.35 &&
    upperLeft < 0.45 &&
    lowerLeft < 0.45 &&
    upperRight > 0.35 &&
    lowerRight > 0.35 &&
    upperLeft + lowerLeft < upperRight + lowerRight - 0.15
  ) {
    return 3;
  }
  return null;
}

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

function countHoles(glyph: Binary): number {
  const { width, height, data } = glyph;
  const seen = new Uint8Array(data.length);
  const queue = new Int32Array(data.length);
  let head = 0;
  let tail = 0;
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (seen[index] || data[index]) return;
    seen[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  while (head < tail) {
    const index = queue[head] ?? 0;
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  let holes = 0;
  for (let index = 0; index < data.length; index += 1) {
    if (data[index] || seen[index]) continue;
    holes += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    push(x, y);
    while (head < tail) {
      const current = queue[head] ?? 0;
      head += 1;
      const cx = current % width;
      const cy = Math.floor(current / width);
      push(cx + 1, cy);
      push(cx - 1, cy);
      push(cx, cy + 1);
      push(cx, cy - 1);
    }
  }
  return holes;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
