import {
  closeCamera,
  openCamera,
  sampleGuide,
  setTorch,
  trackHasTorch,
} from "./camera";
import { closestPlz, isReservedEmergency, lookupPlz, type LocalityAtlas, type LocalityMap, type LocalityPoint } from "./lookup";
import { drawPlaceMap } from "./placeMap";
import type { GuideReading } from "./segmentReader";
import { updateStability, type StabilityState } from "./stability";

const SAMPLE_MS = 80;

type Digit = number | null;

export function mountApp(root: HTMLElement, localities: LocalityMap, atlas: LocalityAtlas): void {
  const app = {
    root,
    localities,
    atlas,
    session: null as CameraSession | null,
  };

  showCamera(app);
}

type App = {
  root: HTMLElement;
  localities: LocalityMap;
  atlas: LocalityAtlas;
  session: CameraSession | null;
};

type CameraSession = {
  stream: MediaStream;
  stop: () => void;
  torchOn: boolean;
};

function showCamera(app: App): void {
  stopSession(app);
  const view = screen(`
    <header class="top">
      <p class="eyebrow">Squawk PLZ</p>
      <h1>Read the squawk</h1>
    </header>
    <p class="lead">Fill the view with the radio. The frame is the shape of the green squawk on the XPDR line.</p>
    <p class="status" data-status></p>
    <div class="stage" data-stage hidden>
      <video data-video playsinline muted></video>
      <div class="guide" data-guide>
        <span></span><span></span><span></span><span></span>
      </div>
    </div>
    <p class="live" data-live aria-live="polite">····</p>
    <div class="actions">
      <button type="button" class="primary" data-start>Start camera</button>
      <button type="button" class="secondary" data-torch hidden>Torch</button>
      <button type="button" class="secondary" data-type>Type code</button>
    </div>
  `);
  app.root.replaceChildren(view);

  const status = mustQuery<HTMLElement>(view, "[data-status]");
  const stage = mustQuery<HTMLElement>(view, "[data-stage]");
  const video = mustQuery<HTMLVideoElement>(view, "[data-video]");
  const guide = mustQuery<HTMLElement>(view, "[data-guide]");
  const live = mustQuery<HTMLElement>(view, "[data-live]");
  const start = mustQuery<HTMLButtonElement>(view, "[data-start]");
  const torchButton = mustQuery<HTMLButtonElement>(view, "[data-torch]");
  const typeButton = mustQuery<HTMLButtonElement>(view, "[data-type]");
  const canvas = document.createElement("canvas");

  let digits: Digit[] = [null, null, null, null];
  let stability: StabilityState = { code: null, since: 0 };
  let raf = 0;
  let lastSample = 0;

  const paint = (reading: GuideReading) => {
    digits = reading.digits;
    live.textContent = reading.digits.map((digit) => (digit === null ? "·" : String(digit))).join("");
  };

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (now - lastSample < SAMPLE_MS) return;
    lastSample = now;
    const reading = sampleGuide(video, guide, canvas);
    if (!reading) return;
    paint(reading);
    const step = updateStability(stability, reading.code, now);
    stability = step.state;
    if (step.locked && reading.code) {
      cancelAnimationFrame(raf);
      raf = 0;
      showConfirm(app, reading.digits);
    }
  };

  typeButton.addEventListener("click", () => {
    showConfirm(app, digits);
  });

  start.addEventListener("click", async () => {
    start.disabled = true;
    status.textContent = "";
    if (!window.isSecureContext) {
      status.textContent = "The camera needs HTTPS. Type the four digits instead.";
      start.disabled = false;
      return;
    }
    try {
      const stream = await openCamera(video);
      stage.hidden = false;
      start.hidden = true;
      const track = stream.getVideoTracks()[0];
      if (trackHasTorch(track)) torchButton.hidden = false;
      torchButton.addEventListener("click", async () => {
        if (!track) return;
        const session = app.session;
        if (!session) return;
        const next = !session.torchOn;
        const applied = await setTorch(track, next);
        if (!applied) {
          torchButton.hidden = true;
          return;
        }
        session.torchOn = next;
        torchButton.textContent = next ? "Torch off" : "Torch";
        torchButton.setAttribute("aria-pressed", next ? "true" : "false");
      });
      app.session = {
        stream,
        torchOn: false,
        stop: () => {
          if (raf) cancelAnimationFrame(raf);
          raf = 0;
          closeCamera(stream, video);
        },
      };
      raf = requestAnimationFrame(tick);
    } catch {
      status.textContent = "Camera is unavailable. Type the four digits instead.";
      start.disabled = false;
    }
  });
}

function showConfirm(app: App, initial: Digit[]): void {
  stopSession(app);
  const view = screen(`
    <header class="top">
      <p class="eyebrow">Squawk PLZ</p>
      <h1>Confirm the code</h1>
    </header>
    <p class="lead">The squawk is used as the decimal PLZ.</p>
    <div class="digits" data-digits></div>
    <p class="emergency" data-emergency hidden>Reserved emergency code.</p>
    <div data-result hidden aria-live="polite">
      <p class="miss" data-miss hidden>No match</p>
      <dl class="result">
        <div data-place-row>
          <dt>Place</dt>
          <dd data-place></dd>
        </div>
      </dl>
      <canvas class="place-map" data-map role="img" hidden></canvas>
    </div>
    <div class="actions">
      <button type="button" class="secondary" data-back>Back</button>
    </div>
  `);
  app.root.replaceChildren(view);

  const digits = mustQuery<HTMLElement>(view, "[data-digits]");
  const emergency = mustQuery<HTMLElement>(view, "[data-emergency]");
  const result = mustQuery<HTMLElement>(view, "[data-result]");
  const place = mustQuery<HTMLElement>(view, "[data-place]");
  const placeRow = view.querySelector("[data-place-row]");
  const miss = mustQuery<HTMLElement>(view, "[data-miss]");
  const map = mustQuery<HTMLCanvasElement>(view, "[data-map]");
  let mapPosition: LocalityPoint | null = null;
  let mapWidth = 0;
  // The map is drawn at the width it has, so it is redrawn when a rotation or resize changes that width.
  new ResizeObserver(() => {
    if (!mapPosition || map.clientWidth === mapWidth) return;
    mapWidth = map.clientWidth;
    drawPlaceMap(map, app.atlas, mapPosition);
  }).observe(map);
  const inputs: HTMLInputElement[] = [];

  for (let index = 0; index < 4; index += 1) {
    const input = document.createElement("input");
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.maxLength = 1;
    input.ariaLabel = `Digit ${index + 1}`;
    input.value = initial[index] === null || initial[index] === undefined ? "" : String(initial[index]);
    input.addEventListener("input", () => {
      input.value = input.value.replace(/[^0-7]/g, "").slice(-1);
      if (input.value && inputs[index + 1]) inputs[index + 1]?.focus();
      refresh();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && input.value === "" && index > 0) {
        inputs[index - 1]?.focus();
      }
    });
    digits.append(input);
    inputs.push(input);
  }

  const codeFromInputs = (): string | null => {
    const code = inputs.map((input) => input.value).join("");
    return /^[0-7]{4}$/.test(code) ? code : null;
  };

  const refresh = () => {
    const code = codeFromInputs();
    emergency.hidden = !(code !== null && isReservedEmergency(code));
    if (!code) {
      result.hidden = true;
      return;
    }
    const hit = lookupPlz(app.localities, code);
    result.hidden = false;
    const shown = hit ?? closestPlz(app.localities, code);
    if (shown) {
      place.textContent = hit ? shown.place : `${shown.plz} ${shown.place}`;
      placeRow?.removeAttribute("hidden");
    } else {
      placeRow?.setAttribute("hidden", "");
    }
    const position = shown ? app.atlas.positions.get(shown.plz) : undefined;
    map.hidden = !position;
    mapPosition = position ?? null;
    if (shown && position) {
      map.ariaLabel = `Map of Switzerland marking ${shown.place}`;
      drawPlaceMap(map, app.atlas, position);
    }
    miss.hidden = hit !== null;
    miss.textContent = shown ? `Closest match is ${shown.plz}` : "No match";
  };

  refresh();
  const firstEmpty = inputs.find((input) => input.value === "") ?? inputs[0];
  firstEmpty?.focus();
  view.querySelector("[data-back]")?.addEventListener("click", () => showCamera(app));
}

function screen(html: string): HTMLElement {
  const wrapper = document.createElement("main");
  wrapper.className = "screen";
  wrapper.innerHTML = html;
  return wrapper;
}

function mustQuery<T extends Element>(parent: ParentNode, selector: string): T {
  const node = parent.querySelector(selector);
  if (!node) throw new Error(`Missing ${selector}`);
  return node as T;
}

function stopSession(app: App): void {
  app.session?.stop();
  app.session = null;
}
