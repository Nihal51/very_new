/**
 * The hours of a local job's bill (1 hour, 3 hours, 12 hours, full day,
 * night): the same rule as the alerts robot's localBill (apps-script/Code.js
 * LOCAL_BASE_HOURS, usedHours — scripts/automation.test.mjs checks they
 * agree), so a page can show the customer the same live meter. From the
 * driver's Arrived tap (booking.clock.startAt) to Job done.
 */

/** Hours each local package includes; past them, each started hour is extra. */
export const LOCAL_BASE_HOURS: Readonly<Record<string, number>> = {
  '1-hour-300': 1,
  '3-hours-600': 3,
  'local-full-day': 8,
  'local-12-hours': 12,
  'night-driver': 10,
};

/** Minutes of a started hour that are not charged: 3 h 15 m is 3 hours, 3 h 16 m is 4. */
export const LOCAL_GRACE_MINUTES = 15;

/** Whole hours from `fromMs` to `toMs`, an hour counting only after the grace minutes. */
export function usedHours(fromMs: number, toMs: number, graceMin = LOCAL_GRACE_MINUTES): number {
  const minutes = Math.floor(Math.max(0, toMs - fromMs) / 60000);
  return Math.max(0, Math.ceil((minutes - graceMin) / 60));
}

/** A local job's hours so far (or in all): what the package includes, used, and extra. null for a package that is not local. */
export function localHours(pkg: string, fromMs: number, toMs: number): { baseHours: number; usedHours: number; extraHours: number } | null {
  const base = LOCAL_BASE_HOURS[pkg];
  if (!base) return null;
  const used = usedHours(fromMs, toMs);
  return { baseHours: base, usedHours: used, extraHours: Math.max(0, used - base) };
}
