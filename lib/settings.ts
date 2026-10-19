/**
 * The checked settings, plus every price formatted the way the site shows it.
 *
 * Pages and content import from here, never from site-settings.ts directly, so
 * every value has been through `checkSettings` and every price is formatted the
 * same way everywhere: Indian digit grouping (₹16,000, ₹1,00,000) and an en dash
 * for ranges (₹1,000–1,200). No price is typed anywhere else in the code —
 * `scripts/check-prices.mjs` fails the build if one is.
 */

import { settings as raw } from '@/site-settings';
import type { TripRules } from './outstation';
import { checkSettings, type SiteSettings } from './settings-schema';

export const settings: SiteSettings = checkSettings(raw);

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** 16000 → "₹16,000" */
export const rupees = (n: number) => `₹${inr.format(n)}`;

/** (1000, 1200) → "₹1,000–1,200"; a range whose ends match collapses to one price. */
export const rupeeRange = (from: number, to: number) =>
  from === to ? rupees(from) : `₹${inr.format(from)}–${inr.format(to)}`;

const { prices: p, monthly: m } = settings;

/** "1 day" / "2 days". */
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

const joiningFee = {
  from: Math.round((m.basic.from * m.joiningFeePercent) / 100),
  to: Math.round((m.basic.to * m.joiningFeePercent) / 100),
};
const premiumJoiningFee = Math.round((m.premium * m.premiumJoiningFeePercent) / 100);

/** Every price as display text. Content, schema and the Hindi pages read these. */
export const priceText = {
  oneHour: rupees(p.oneHour),
  threeHours: rupees(p.threeHours),
  fullDay: rupeeRange(p.fullDay.from, p.fullDay.to),
  /** Per day of an outstation trip or one-way drop. */
  outstation: rupeeRange(p.outstation.from, p.outstation.to),
  /** Per hour the driver is still travelling home after the paid days, and the daily maximum. */
  outstationReturnHour: rupees(settings.outstation.returnHour),
  outstationReturnMax: rupees(settings.outstation.returnMaxPerDay),
  outstationExtraHour: rupees(settings.outstation.extraHour),
  outstationHours: `${settings.outstation.hoursPerDay} hours`,
  mealAllowance: rupees(settings.outstation.mealAllowance),
  nightFrom: rupees(p.nightFrom),
  /** The lowest price on the site, for "from ₹300" lines. */
  startingFrom: rupees(Math.min(p.oneHour, p.threeHours, p.fullDay.from, p.nightFrom)),
  basic: rupeeRange(m.basic.from, m.basic.to),
  basicFrom: rupees(m.basic.from),
  premium: rupees(m.premium),
  joiningFee: rupeeRange(joiningFee.from, joiningFee.to),
  joiningFeePercent: `${m.joiningFeePercent}%`,
  premiumJoiningFee: rupees(premiumJoiningFee),
  premiumJoiningFeePercent: `${m.premiumJoiningFeePercent}%`,
  extraHour: rupees(m.extraHour),
  standIn: rupees(m.standInPerDay),
  replacement: `within ${days(m.replacementDays)}`,
  /** Partner program rewards (/partners/). */
  partnerMonthly: rupees(settings.partners.monthlyCustomer),
  partnerCommission: `${settings.partners.commissionPercent}%`,
  /** What the commission means on a driver-only full day, e.g. "₹100–120". */
  partnerCommissionFullDay: rupeeRange(
    Math.round((p.fullDay.from * settings.partners.commissionPercent) / 100),
    Math.round((p.fullDay.to * settings.partners.commissionPercent) / 100),
  ),
  partnerDiscount: rupees(settings.partners.joiningDiscount),
} as const;

/** Whole-rupee bounds of everything sold at a listed price, for JSON-LD priceRange/minPrice. */
export const priceBounds = {
  min: Math.min(p.oneHour, p.threeHours, p.fullDay.from, p.outstation.from, p.nightFrom),
  max: Math.max(p.oneHour, p.threeHours, p.fullDay.to, p.outstation.to, p.nightFrom),
};

export { joiningFee as joiningFeeAmount };

/** The trip rules for lib/outstation.ts, from the checked settings. */
export const tripRules: TripRules = {
  dayRate: { from: p.outstation.from, to: p.outstation.to },
  returnHour: settings.outstation.returnHour,
  returnMaxPerDay: settings.outstation.returnMaxPerDay,
  extraHour: settings.outstation.extraHour,
  hoursPerDay: settings.outstation.hoursPerDay,
  kmPerDay: settings.outstation.kmPerDay,
  averageKmh: settings.outstation.averageKmh,
  busKmh: settings.outstation.busKmh,
  stationHours: settings.outstation.stationHours,
  localWithinKm: settings.outstation.localWithinKm,
};
