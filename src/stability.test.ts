import { describe, expect, it } from "vitest";
import { updateStability } from "./stability";

describe("updateStability", () => {
  it("locks after the same code holds for half a second", () => {
    const first = updateStability({ code: null, since: 0 }, "0123", 1000);
    expect(first.locked).toBe(false);
    const held = updateStability(first.state, "0123", 1499);
    expect(held.locked).toBe(false);
    const locked = updateStability(held.state, "0123", 1500);
    expect(locked.locked).toBe(true);
    expect(locked.state.code).toBe("0123");
  });

  it("resets when the read drops or changes", () => {
    const started = updateStability({ code: "0123", since: 1000 }, null, 1400);
    expect(started.locked).toBe(false);
    expect(started.state.code).toBeNull();
    const changed = updateStability({ code: "0123", since: 1000 }, "0124", 2000);
    expect(changed.locked).toBe(false);
    expect(changed.state.since).toBe(2000);
  });
});
