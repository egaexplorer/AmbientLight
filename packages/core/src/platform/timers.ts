/**
 * Minimal timer and clock access that works in Node.js, Electron and React Native
 * without pulling DOM or Node.js type definitions into the platform-agnostic core.
 */

export type TimerHandle = unknown;

interface TimerGlobals {
  setTimeout(callback: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

// Looked up on every call so test runners that mock timers are respected.
const timers = globalThis as unknown as TimerGlobals;

export function setTimer(callback: () => void, ms: number): TimerHandle {
  return timers.setTimeout(callback, ms);
}

export function clearTimer(handle: TimerHandle): void {
  timers.clearTimeout(handle);
}

export interface Clock {
  /** Milliseconds; only differences between calls are meaningful. */
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimer(resolve, Math.max(0, ms));
  });
}
