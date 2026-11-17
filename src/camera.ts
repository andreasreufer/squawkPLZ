import { findSquawk, type GuideReading, type Raster } from "./segmentReader";

export type Rect = { left: number; top: number; width: number; height: number };

export type VideoFrame = { videoWidth: number; videoHeight: number; rect: Rect };

export function mapGuideToVideo(video: VideoFrame, guide: Rect): Rect | null {
  const { videoWidth, videoHeight, rect } = video;
  if (videoWidth < 1 || videoHeight < 1 || rect.width < 1 || rect.height < 1) return null;
  if (guide.width < 1 || guide.height < 1) return null;

  const elementRatio = rect.width / rect.height;
  const frameRatio = videoWidth / videoHeight;
  let sx: number;
  let sy: number;
  let sw: number;
  let sh: number;

  if (frameRatio > elementRatio) {
    sh = videoHeight;
    sw = sh * elementRatio;
    sx = (videoWidth - sw) / 2;
    sy = 0;
  } else {
    sw = videoWidth;
    sh = sw / elementRatio;
    sx = 0;
    sy = (videoHeight - sh) / 2;
  }

  const scaleX = sw / rect.width;
  const scaleY = sh / rect.height;
  const left = sx + (guide.left - rect.left) * scaleX;
  const top = sy + (guide.top - rect.top) * scaleY;
  const width = guide.width * scaleX;
  const height = guide.height * scaleY;

  const clampedLeft = clamp(left, 0, videoWidth);
  const clampedTop = clamp(top, 0, videoHeight);
  const clampedWidth = Math.min(width - (clampedLeft - left), videoWidth - clampedLeft);
  const clampedHeight = Math.min(height - (clampedTop - top), videoHeight - clampedTop);
  if (clampedWidth < 1 || clampedHeight < 1) return null;

  return { left: clampedLeft, top: clampedTop, width: clampedWidth, height: clampedHeight };
}

const SAMPLE_EDGE = 960;

export function sampleGuide(
  video: HTMLVideoElement,
  guide: HTMLElement,
  canvas: HTMLCanvasElement,
): GuideReading | null {
  const source = mapGuideToVideo(
    {
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      rect: video.getBoundingClientRect(),
    },
    guide.getBoundingClientRect(),
  );
  if (!source) return null;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const aspect = source.width / source.height;
  let sampleWidth = SAMPLE_EDGE;
  let sampleHeight = Math.max(1, Math.round(SAMPLE_EDGE / aspect));
  if (sampleHeight > SAMPLE_EDGE) {
    sampleHeight = SAMPLE_EDGE;
    sampleWidth = Math.max(1, Math.round(SAMPLE_EDGE * aspect));
  }
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  context.drawImage(video, source.left, source.top, source.width, source.height, 0, 0, sampleWidth, sampleHeight);
  const image = context.getImageData(0, 0, sampleWidth, sampleHeight);
  return findSquawk(image as Raster);
}

export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser has no camera API.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

export function closeCamera(stream: MediaStream | null, video: HTMLVideoElement): void {
  stream?.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
}

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };
type TorchConstraint = MediaTrackConstraintSet & { torch?: boolean };

export function trackHasTorch(track: MediaStreamTrack | undefined): boolean {
  if (!track || typeof track.getCapabilities !== "function") return false;
  const capabilities = track.getCapabilities() as TorchCapabilities;
  return capabilities.torch === true;
}

export async function setTorch(track: MediaStreamTrack, on: boolean): Promise<boolean> {
  if (!trackHasTorch(track)) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as TorchConstraint] });
    return true;
  } catch {
    return false;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
