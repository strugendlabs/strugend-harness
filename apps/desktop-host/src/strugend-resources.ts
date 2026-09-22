/** Device admission for optional local inference; the primary provider remains independent. */
import { freemem, totalmem } from 'node:os'

/** Resource observations can be supplied by native-platform qualification. */
export interface DecisionResources { totalMiB: number; freeMiB: number }
/** Device-specific admission budgets from the settings service. */
export interface DecisionResourceLimits { minTotalMemoryMiB: number; minFreeMemoryMiB: number; criticalFreeMemoryMiB: number }

/** @returns OS physical-memory totals in MiB, without allocating a model. */
export function decisionResources(): DecisionResources { return { totalMiB: totalmem() / 1_048_576, freeMiB: freemem() / 1_048_576 } }

/**
 * Keep low-memory devices on remote auxiliary inference or Core alone.
 * @param resources - Fresh physical-memory observations.
 * @param limits - Configured minimum device size and free-memory reserve.
 * @param warm - Whether the shared model is already resident.
 * @returns Admission result and a user-readable reason when local inference is unavailable.
 */
export function localDecisionAdmission(
  resources: DecisionResources, limits: DecisionResourceLimits, warm: boolean,
): { allowed: boolean; reason?: string } {
  if (resources.totalMiB < limits.minTotalMemoryMiB) return { allowed: false, reason: 'Local Decision is paused on this memory tier. Use Automatic with an optional remote key; Core remains available.' }
  if (resources.freeMiB < (warm ? limits.criticalFreeMemoryMiB : limits.minFreeMemoryMiB)) return { allowed: false, reason: 'Local Decision is paused to reserve memory for the app and primary model tools.' }
  return { allowed: true }
}
