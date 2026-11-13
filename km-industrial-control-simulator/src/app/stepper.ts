/**
 * Fixed-step accumulator for the real-time loop.
 * Converts elapsed wall-clock time into a whole number of controller scans, so the simulation
 * is deterministic regardless of the display frame rate.
 */
export const MAX_REAL_FRAME_S = 0.25;

export interface StepResult {
  steps: number;
  accumulator: number;
}

export function stepsForFrame(
  accumulatorS: number,
  realDtS: number,
  speed: number,
  scanS: number,
  maxSteps: number,
): StepResult {
  if (!Number.isFinite(realDtS) || realDtS <= 0 || !Number.isFinite(speed) || speed <= 0) {
    return { steps: 0, accumulator: accumulatorS };
  }
  // A long gap (hidden tab, debugger) must not fast-forward the process.
  const dt = Math.min(realDtS, MAX_REAL_FRAME_S);
  const acc = accumulatorS + dt * speed;
  const steps = Math.floor(acc / scanS + 1e-9);
  if (steps > maxSteps) return { steps: maxSteps, accumulator: 0 }; // drop backlog instead of spiralling
  return { steps, accumulator: Math.max(0, acc - steps * scanS) };
}
