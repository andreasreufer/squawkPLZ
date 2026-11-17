import { describe, expect, it } from "vitest";
import { mapGuideToVideo } from "./camera";

describe("mapGuideToVideo", () => {
  it("crops the sides of a wide frame and maps the guide into video pixels", () => {
    const mapped = mapGuideToVideo(
      {
        videoWidth: 1920,
        videoHeight: 1080,
        rect: { left: 0, top: 0, width: 390, height: 280 },
      },
      { left: 39, top: 100, width: 312, height: 80 },
    );
    expect(mapped).not.toBeNull();
    if (!mapped) return;
    const elementRatio = 390 / 280;
    const visibleWidth = 1080 * elementRatio;
    const cropX = (1920 - visibleWidth) / 2;
    expect(mapped.left).toBeCloseTo(cropX + (39 / 390) * visibleWidth);
    expect(mapped.top).toBeCloseTo((100 / 280) * 1080);
    expect(mapped.width).toBeCloseTo((312 / 390) * visibleWidth);
    expect(mapped.height).toBeCloseTo((80 / 280) * 1080);
  });

  it("returns null when the video has no dimensions yet", () => {
    expect(
      mapGuideToVideo(
        { videoWidth: 0, videoHeight: 0, rect: { left: 0, top: 0, width: 100, height: 100 } },
        { left: 10, top: 10, width: 80, height: 40 },
      ),
    ).toBeNull();
  });
});
