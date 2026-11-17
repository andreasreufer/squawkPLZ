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
