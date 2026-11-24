import type { LocalityAtlas, LocalityPoint } from "./lookup";

type Bounds = { west: number; east: number; south: number; north: number };

const MARGIN = 6;

/** Draws every locality as a faint dot, which outlines the country, and rings the chosen place. */
export function drawPlaceMap(canvas: HTMLCanvasElement, atlas: LocalityAtlas, place: LocalityPoint): void {
  const bounds = boundsOf(atlas.points);
  if (!bounds) return;
  const cssWidth = canvas.clientWidth || 320;
  const cssHeight = Math.round(((bounds.north - bounds.south) / (bounds.east - bounds.west)) * (cssWidth - 2 * MARGIN)) + 2 * MARGIN;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  canvas.style.height = `${cssHeight}px`;

  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  const scale = (cssWidth - 2 * MARGIN) / (bounds.east - bounds.west);
  const x = (point: LocalityPoint) => MARGIN + (point.e - bounds.west) * scale;
  const y = (point: LocalityPoint) => MARGIN + (bounds.north - point.n) * scale;

  const styles = getComputedStyle(canvas);
  context.fillStyle = styles.getPropertyValue("--muted").trim() || "#b7b39a";
  context.globalAlpha = 0.45;
  for (const point of atlas.points) context.fillRect(x(point) - 0.75, y(point) - 0.75, 1.5, 1.5);
  context.globalAlpha = 1;

  const accent = styles.getPropertyValue("--amber").trim() || "#f0b429";
  context.strokeStyle = accent;
  context.lineWidth = 2;
  context.beginPath();
  context.arc(x(place), y(place), 9, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = accent;
  context.beginPath();
  context.arc(x(place), y(place), 3.5, 0, Math.PI * 2);
  context.fill();
}

let cached: { points: readonly LocalityPoint[]; bounds: Bounds | null } | null = null;

function boundsOf(points: readonly LocalityPoint[]): Bounds | null {
  if (cached?.points === points) return cached.bounds;
  let bounds: Bounds | null = null;
  for (const { e, n } of points) {
    if (!bounds) bounds = { west: e, east: e, south: n, north: n };
    else {
      bounds.west = Math.min(bounds.west, e);
      bounds.east = Math.max(bounds.east, e);
      bounds.south = Math.min(bounds.south, n);
      bounds.north = Math.max(bounds.north, n);
    }
  }
  if (bounds && (bounds.east === bounds.west || bounds.north === bounds.south)) bounds = null;
  cached = { points, bounds };
  return bounds;
}
