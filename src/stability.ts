export type StabilityState = { code: string | null; since: number };

export const STABLE_HOLD_MS = 500;

export function updateStability(
  state: StabilityState,
  code: string | null,
  now: number,
  holdMs = STABLE_HOLD_MS,
): { state: StabilityState; locked: boolean } {
  if (code === null || state.code !== code) {
    return { state: { code, since: now }, locked: false };
  }
  return { state, locked: now - state.since >= holdMs };
}
