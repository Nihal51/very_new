/**
 * Job offers (firestore.rules, offers/{bookingId}): a booking offered to the
 * drivers of its city in the DriveBuddy Driver app, with what the driver earns
 * — the price minus DriveBuddy's cut. Pure, so it is tested without Firebase.
 */

import type { DriverRef } from './bookings.ts';

/** released: the driver gave it back before Start ("Can't make it"); the robot offers it again. */
export type OfferStatus = 'open' | 'taken' | 'withdrawn' | 'released';

export type Offer = {
  bookingId: string;
  ref: string;
  city: string;
  package: string;
  when: string;
  area: string;
  to: string;
  price: number;
  cutPercent: number;
  driverPay: number;
  status: OfferStatus;
  takenBy: DriverRef | null;
  takenAt?: Date;
  done: boolean;
  paid: boolean;
  paidAt?: Date;
  createdAt?: Date;
  /** Who posted it: an admin's uid, or 'robot' for an automatic offer (its cut drops 30 → 25 → 20% while nobody takes it). */
  by?: string;
  /**
   * Where drivers see it: its own city, and the nearby ones once the robot
   * widens it (nobody took it 10 minutes after the top pay). Older offers
   * have none: their city only.
   */
  cities?: string[];
  /**
   * Cash the driver kept from the customer for this job (he tapped "Paid in
   * cash" in the Driver app). The alerts robot's: it comes off what
   * DriveBuddy pays him (offerSettlement).
   */
  cashCollected?: number;
};

/**
 * One job's settlement with the driver: what he earned, the cash he kept,
 * and net = earned − cash — DriveBuddy pays him net, or (net < 0) collects
 * −net from him. The same sum as the robot's weekly payout.
 */
export function offerSettlement(o: Pick<Offer, 'driverPay' | 'cashCollected'>): { earned: number; cash: number; net: number } {
  const earned = Math.max(0, Math.round(o.driverPay || 0));
  const c = Number(o.cashCollected);
  const cash = Number.isInteger(c) && c > 0 ? c : 0;
  return { earned, cash, net: earned - cash };
}

/** The cities an offer is posted to: an admin's offer goes to its own city only (firestore.rules checks it). */
export const offerCitiesFor = (city: string): string[] => [city];

/**
 * DriveBuddy's cut, in whole percent: the same band as the quote calculator
 * (site-settings.ts outstation.targetProfitPercent / min / max) and as
 * firestore.rules (offers, cutPercent). scripts/offers.test.mjs keeps all three
 * in step.
 */
export const CUT = { min: 20, max: 30, default: 25 } as const;

export const clampCut = (n: number) => Math.min(CUT.max, Math.max(CUT.min, Math.round(Number.isFinite(n) ? n : CUT.default)));

/** What the driver earns from `price` after a `cutPercent` cut, rounded down to ₹10 (DriveBuddy keeps the rest). */
export function driverPayFor(price: number, cutPercent: number): number {
  const p = Math.max(0, Math.round(price));
  return Math.floor((p * (100 - clampCut(cutPercent))) / 100 / 10) * 10;
}

/**
 * The area drivers see before they accept (never the full address): the pickup
 * without its first part when it has several ("12, Shankar Nagar, Raipur" →
 * "Shankar Nagar, Raipur"), at most 120 characters. The admin can edit it.
 */
export function offerArea(pickup: string): string {
  const parts = pickup
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const area = (parts.length > 1 ? parts.slice(1) : parts).join(', ');
  return area.slice(0, 120);
}
