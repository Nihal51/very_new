/**
 * All marketing content in one place, typed. Pages render from these arrays so
 * copy edits never require touching layout code.
 * Content carried over from the original single-file site.
 */

import type { IconName } from '@/components/icons';
import { priceText, settings } from './settings';

/* Prices, phone numbers and monthly-plan terms are NOT typed in this file: they come
   from site-settings.ts through `priceText` / `settings`, so changing a price there
   changes every sentence below. `scripts/check-prices.mjs` fails the build if a
   ₹ figure is typed here by hand. */
const phone = settings.contact.phone;
const m = settings.monthly;
const day = (n: number) => (n === 1 ? 'day' : 'days');

/* ---------------------------------------------------------------- services */

export type Service = {
  slug: string;
  icon: IconName;
  title: string;
  short: string;
  body: string;
  /** SEO for the dedicated /services/<slug>/ landing page. */
  heading: string;
  metaTitle: string;
  metaDescription: string;
  badge?: string;
  includes: string[];
  /**
   * The newer, quote-priced services. They get their own row on /services and a
   * "Also available" strip on the home page instead of a full card, so the four
   * hourly services keep the home page's two-by-two grid.
   */
  extra?: boolean;
  /**
   * Set for services that are not sold at the hourly rates: the landing page then
   * shows how the quote is worked out instead of the hourly price cards, which
   * would quote the wrong product.
   */
  quote?: {
    title: string;
    body: string;
    factors: string[];
    /**
     * Pre-filled WhatsApp message with blanks for exactly what dispatch needs to
     * price the job, so the first message already carries a quotable request
     * instead of "hi, how much?".
     */
    whatsapp: string;
  };
  /**
   * Fixed-price plans the customer chooses between (the monthly driver's Basic and
   * Premium). When set, the landing page shows the plan cards and comparison table
   * in place of the quote section, and the JSON-LD carries one Offer per plan.
   */
  tiers?: readonly MonthlyPlan[];
  /** Questions specific to this service — shown first on its page and in its FAQPage markup. */
  faqs?: Faq[];
};

/* ------------------------------------------------------- monthly plans */

/**
 * Monthly driver plans. Every figure and promise here was set by the owner on
 * 7 Oct 2026 — change them only on the owner's word, and keep the Hindi copy in
 * lib/content-hi.ts in step.
 */
/** The monthly plans' shared terms, as set in site-settings.ts. */
export const monthlyTerms = {
  hoursPerDay: m.hoursPerDay,
  daysOffPerMonth: m.daysOffPerMonth,
  overtime: priceText.extraHour,
  standIn: priceText.standIn,
  replacement: priceText.replacement,
} as const;

export type MonthlyPlan = {
  id: 'basic' | 'premium';
  name: string;
  /** As displayed, e.g. "₹16,000–17,000". */
  price: string;
  /** For the JSON-LD Offer. */
  min: number;
  max: number;
  /** One-time joining fee, or null when there is none. */
  joiningFee: string | null;
  blurb: string;
  recommended?: boolean;
  highlights: string[];
  /** Value stored by the booking form; must match firestore.rules. */
  packageValue: string;
  whatsapp: string;
};

const planWhatsapp = (plan: string) =>
  `Hi DriveBuddy, I want a monthly driver on the ${plan} plan.\nCity:\nDaily timing (${m.hoursPerDay} hours, e.g. 9 AM – 6 PM):\nWeekly off day:\nStart date:`;

const joiningFeeShort =
  m.joiningFeePercent > 0 ? `${priceText.joiningFeePercent} of one month (${priceText.joiningFee})` : null;

export const monthlyPlans: readonly MonthlyPlan[] = [
  {
    id: 'basic',
    name: 'Basic',
    price: priceText.basic,
    min: m.basic.from,
    max: m.basic.to,
    joiningFee: joiningFeeShort && `One-time joining fee: ${joiningFeeShort}`,
    blurb: 'A verified driver at the lowest monthly price, with a replacement guarantee for the first month.',
    highlights: [
      `A verified driver, ${m.hoursPerDay} hours a day`,
      `New driver ${priceText.replacement} if yours quits in the first month`,
      `Stand-in driver on leave days: ${priceText.standIn} a day`,
      'Police-verified, with 5+ years of experience',
    ],
    packageValue: 'monthly-basic',
    whatsapp: planWhatsapp('Basic'),
  },
  {
    id: 'premium',
    name: 'Premium',
    price: priceText.premium,
    min: m.premium,
    max: m.premium,
    joiningFee: null,
    blurb: `Never be left without a driver: a free stand-in on leave days, and a new driver ${priceText.replacement} if yours ever leaves.`,
    recommended: true,
    highlights: [
      `A verified driver, ${m.hoursPerDay} hours a day`,
      'Free stand-in driver whenever yours takes leave',
      `New verified driver ${priceText.replacement} if yours quits — any time`,
      'No joining fee',
    ],
    packageValue: 'monthly-premium',
    whatsapp: planWhatsapp('Premium'),
  },
];

/** Row-by-row comparison shown under the plan cards. */
export const monthlyComparison: readonly { label: string; basic: string; premium: string }[] = [
  { label: 'Monthly charge', basic: priceText.basic, premium: priceText.premium },
  { label: 'Joining fee (one time)', basic: joiningFeeShort ?? 'None', premium: 'None' },
  { label: 'Working hours', basic: `${m.hoursPerDay} hours a day`, premium: `${m.hoursPerDay} hours a day` },
  { label: 'Extra hours', basic: `${priceText.extraHour} an hour`, premium: `${priceText.extraHour} an hour` },
  {
    label: 'Weekly off',
    basic: `${m.daysOffPerMonth} ${day(m.daysOffPerMonth)} a month`,
    premium: `${m.daysOffPerMonth} ${day(m.daysOffPerMonth)} a month`,
  },
  { label: 'Driver takes leave', basic: `Stand-in driver, ${priceText.standIn} a day`, premium: 'Stand-in driver, free' },
  {
    label: 'Driver quits in the first month',
    basic: `New driver ${priceText.replacement}, free`,
    premium: `New driver ${priceText.replacement}, free`,
  },
  { label: 'Driver quits after the first month', basic: 'Not included', premium: `New driver ${priceText.replacement}, free` },
];

export const services: Service[] = [
  {
    slug: 'personal-driver',
    icon: 'steering',
    title: 'Personal Driver',
    short: 'Your car, our driver — errands, school runs and the daily commute.',
    body: 'A verified driver takes the wheel of your own vehicle for as long as you need. Ideal for the daily office commute, school pickups, shopping trips or a day of errands without the parking hassle.',
    heading: 'Personal driver for your own car',
    metaTitle: 'Personal Driver on Hire, Hourly or Full Day',
    metaDescription:
      `Hire a personal driver for your own car in Raipur, Bhilai, Durg and Bilaspur — hourly, half-day or full day. Police-verified, sober, from ${priceText.oneHour}.`,
    badge: 'Most booked',
    includes: [
      'Hourly, half-day or full-day booking',
      'Same driver for the whole booking',
      'Comfortable with manual and automatic',
      'Knows local routes and shortcuts',
    ],
  },
  {
    slug: 'medical-transport',
    icon: 'heart',
    title: 'Medical Transport',
    short: 'Hospital visits, clinic appointments and emergency transfers.',
    body: 'Calm, patient drivers for hospital and clinic journeys. They wait through the appointment, help with boarding, and drive gently — which matters a great deal when you have elderly parents or a patient in the car.',
    heading: 'Medical and hospital transport driver',
    metaTitle: 'Hospital and Medical Transport Driver',
    metaDescription:
      'A calm, police-verified driver for hospital and clinic visits in Raipur, Bhilai, Durg and Bilaspur. Waiting time included, priority dispatch, 24/7.',
    badge: '24/7 priority',
    includes: [
      'Priority dispatch for emergencies',
      'Waiting time included',
      'Extra care boarding and alighting',
      'Familiar with major hospitals in all four cities',
    ],
  },
  {
    slug: 'night-safety-driver',
    icon: 'moon',
    title: 'Night Safety Driver',
    short: 'Verified late-night travel for women, families and office returns.',
    body: `A dedicated night shift from 8 PM to 6 AM, starting from ${priceText.nightFrom}. Every night driver is police-verified and breath-tested before the shift starts, so a late finish at the office never has to mean an unsafe ride home.`,
    heading: 'Night driver service, 8 PM to 6 AM',
    metaTitle: 'Night Driver Service, 8 PM to 6 AM',
    metaDescription:
      `Book a verified night driver from 8 PM to 6 AM in Raipur, Bhilai, Durg and Bilaspur — a safe ride home for women, families and late shifts, from ${priceText.nightFrom}.`,
    badge: 'Popular choice',
    includes: [
      `From ${priceText.nightFrom} for the 8 PM – 6 AM window`,
      'Breathalyser check before every shift',
      'Driver details shared before arrival',
      'Preferred by women travelling alone',
    ],
  },
  {
    slug: 'airport-outstation',
    icon: 'plane',
    title: 'Airport & Outstation',
    short: 'Flight-tracked pickups, drops and long-distance highway trips.',
    body: 'Airport transfers with your flight tracked, so the driver is waiting whether you land early or three hours late. For journeys beyond the city, highway-experienced drivers handle long stretches and overnight halts.',
    heading: 'Airport pickups and outstation drivers',
    metaTitle: 'Airport and Outstation Drivers on Hire',
    metaDescription:
      'Flight-tracked airport pickups and highway-experienced outstation drivers from Raipur, Bhilai, Durg and Bilaspur. You keep your car; we drive it.',
    badge: 'Flight tracked',
    includes: [
      'Live flight tracking for pickups',
      'Meet-and-greet at arrivals',
      'Highway-experienced drivers',
      'Night halts arranged on request',
    ],
  },
  {
    slug: 'monthly-driver',
    icon: 'calendar',
    title: 'Monthly Driver',
    short: `A regular verified driver for your own car — Basic or Premium plan, from ${priceText.basicFrom} a month.`,
    body: `A dedicated driver for your own car on a monthly plan — the office commute, school runs, parents’ appointments and weekend errands, with the same person behind the wheel day after day. ${m.hoursPerDay} hours a day, ${m.daysOffPerMonth} ${day(m.daysOffPerMonth)} off a month, and every driver verified exactly like every other DriveBuddy driver before they start.`,
    heading: 'Monthly and permanent driver for your car',
    metaTitle: 'Monthly Driver on Hire — Permanent Car Driver',
    metaDescription:
      `Monthly driver for your own car in Raipur, Bhilai, Durg and Bilaspur. Basic plan ${priceText.basic}, Premium ${priceText.premium} with free stand-in drivers. ${m.hoursPerDay} hours a day.`,
    badge: 'Monthly plan',
    extra: true,
    includes: [
      'A regular driver for your daily routine',
      `${m.hoursPerDay} hours a day, ${m.daysOffPerMonth} ${day(m.daysOffPerMonth)} off a month`,
      'Police-verified, with 5+ years of experience',
      'Comfortable with manual and automatic',
    ],
    tiers: monthlyPlans,
    faqs: [
      {
        q: 'How much does a monthly driver cost?',
        a: `The Basic plan is ${priceText.basic} a month${m.joiningFeePercent > 0 ? ` plus a one-time joining fee of ${priceText.joiningFeePercent} of one month` : ''}. The Premium plan is ${priceText.premium} a month with no joining fee. Both give you a verified driver for ${m.hoursPerDay} hours a day with ${m.daysOffPerMonth} ${day(m.daysOffPerMonth)} off a month; extra hours are ${priceText.extraHour} an hour.`,
      },
      {
        q: 'What is the difference between the Basic and Premium plans?',
        a: `What happens when your driver is away. On Premium, a stand-in driver comes free whenever your driver takes leave, and if your driver quits at any time we send a new verified driver ${priceText.replacement}; there is no joining fee. On Basic, a stand-in costs ${priceText.standIn} a day, and the free replacement ${priceText.replacement} applies only if the driver quits in the first month.`,
      },
      {
        q: 'Can I hire a permanent driver through DriveBuddy?',
        a: `Yes — that is what the monthly plans are for: the same verified driver for your own car, ${m.hoursPerDay} hours a day. Call ${phone} or message us on WhatsApp with your city, timing and start date.`,
      },
    ],
  },
  {
    slug: 'wedding-event-driver',
    icon: 'star',
    title: 'Wedding & Event Driver',
    short: 'Drivers for the baraat, guest pickups and late-night drops after the function.',
    body: 'Weddings and family functions need more drivers than any family has. We supply verified, sober drivers for the baraat and family cars, guest pickups from the station and airport, and safe drops after a late function — so the people who would otherwise be driving can enjoy the day.',
    heading: 'Drivers for weddings and family functions',
    metaTitle: 'Wedding and Event Driver on Hire',
    metaDescription:
      'Hire verified, sober drivers for weddings, baraat cars, guest pickups and functions in Raipur, Bhilai, Durg and Bilaspur. One car or several.',
    badge: 'Book ahead',
    extra: true,
    includes: [
      'Drivers for the baraat and family cars',
      'Guest pickups from the station and airport',
      'Safe drops after a late function',
      'Breath-tested before duty, zero alcohol',
    ],
    quote: {
      title: 'Quoted for your event',
      body: 'Every function is different, so we quote it as a whole once we know the plan. In the wedding season, book a few days ahead so we can hold enough drivers for every car.',
      factors: [
        'Number of cars that need a driver',
        'Hours per driver',
        'Late-night drops',
        'Travel between venues or towns',
      ],
      whatsapp:
        'Hi DriveBuddy, I need drivers for an event.\nEvent date(s):\nCity / venue:\nHow many cars need a driver:\nTimings (from – to):',
    },
    faqs: [
      {
        q: 'Can I book drivers for a wedding?',
        a: 'Yes. Tell us the date, how many cars need a driver and the timings — baraat, guest pickups, late-night drops — and we will quote the whole event and assign a verified driver to each car.',
      },
      {
        q: 'How early should I book a wedding driver?',
        a: 'As early as you can, especially in the wedding season. A few days’ notice lets us hold enough drivers for every car.',
      },
    ],
  },
  {
    slug: 'one-way-car-drop',
    icon: 'route',
    title: 'One-Way Car Drop',
    short: 'Our driver takes your car to another city, then makes their own way back.',
    body: 'Need your car in another city without driving it there yourself? A verified driver delivers it — to a new posting, to family in another town, or to meet you at the end of a trip — and then makes their own way back. Ride along, or send the car on its own.',
    heading: 'One-way car drop to another city',
    metaTitle: 'One-Way Car Drop Driver, Outstation',
    metaDescription:
      'A verified driver takes your car one way to another city from Raipur, Bhilai, Durg or Bilaspur, then returns on their own. Ride along or send the car alone.',
    badge: 'One way',
    extra: true,
    includes: [
      'Your car driven to the city you need',
      'Ride along, or send the car on its own',
      'Highway-experienced drivers',
      'The driver arranges their own way back',
    ],
    quote: {
      title: 'Quoted per trip',
      body: 'A one-way drop is priced on the distance and the driver’s journey back. You get the full figure on the call, before the driver sets off.',
      factors: [
        'Distance to the destination',
        'The driver’s journey back',
        'Day or night travel',
      ],
      whatsapp:
        'Hi DriveBuddy, I need a one-way car drop.\nFrom (city / area):\nTo (city / address):\nDate and time:\nCar model:',
    },
    faqs: [
      {
        q: 'Can a driver take my car to another city without me?',
        a: `Yes. With a one-way car drop, a verified driver delivers your car to the address you give and then returns on their own. Call ${phone} with the pickup, the destination and the date for a quote.`,
      },
      {
        q: 'Is the driver’s return journey included in the price?',
        a: 'Yes. The quote you get on the call covers the drive and the driver’s way back, so there is one figure and nothing extra to settle at the other end.',
      },
    ],
  },
];

/* ---------------------------------------------------------------- pricing  */

export type Plan = {
  id: string;
  eyebrow: string;
  name: string;
  blurb: string;
  /** As displayed — from site-settings.ts. */
  price: string;
  /** The same price as numbers, for the JSON-LD Offer. */
  min: number;
  max: number;
  unit: string;
  featured?: boolean;
  features: string[];
};

export const plans: Plan[] = [
  {
    id: '1-hour',
    eyebrow: 'Starter',
    name: '1 Hour',
    blurb: 'Quick trips, short errands and pickups.',
    price: priceText.oneHour,
    min: settings.prices.oneHour,
    max: settings.prices.oneHour,
    unit: 'per booking',
    features: [
      'Up to 1 hour of driving',
      'Police-verified driver',
      '30-minute arrival guarantee',
      'Your own vehicle',
    ],
  },
  {
    id: '3-hours',
    eyebrow: 'Most popular',
    name: '3 Hours',
    blurb: 'Best value for daily use and outings.',
    price: priceText.threeHours,
    min: settings.prices.threeHours,
    max: settings.prices.threeHours,
    unit: 'per booking',
    featured: true,
    features: [
      'Up to 3 hours of driving',
      'Police-verified driver',
      '30-minute arrival guarantee',
      'Your own vehicle',
      'Priority driver assignment',
    ],
  },
  {
    id: 'full-day',
    eyebrow: 'Full day',
    name: 'Local Full Day',
    blurb: 'All-day local errands and city trips.',
    price: priceText.fullDay,
    min: settings.prices.fullDay.from,
    max: settings.prices.fullDay.to,
    unit: 'per day',
    features: [
      '8 hours of dedicated driving',
      'Senior verified driver',
      '30-minute arrival guarantee',
      'Your own vehicle',
      'Driver break coverage included',
    ],
  },
  {
    id: 'outstation',
    eyebrow: 'Outstation',
    name: 'Outstation Trip',
    blurb: 'Long-distance journeys beyond the city.',
    price: priceText.outstation,
    min: settings.prices.outstation.from,
    max: settings.prices.outstation.to,
    unit: 'per trip',
    features: [
      'Long-distance highway driving',
      'Highway-experienced driver',
      'Night halts on request',
      'Your own vehicle',
      'Custom quote available',
    ],
  },
];

/** Rates that do not fit the card grid. */
export const extraRates = [
  {
    label: 'Night driver',
    detail: '8 PM – 6 AM',
    price: `from ${priceText.nightFrom}`,
  },
  {
    label: 'Hospital / emergency',
    detail: 'Priority dispatch — call us directly',
    price: 'On call',
  },
  {
    label: 'Monthly driver',
    detail: `Basic ${priceText.basic} · Premium ${priceText.premium} a month`,
    price: `from ${priceText.basicFrom}`,
  },
  {
    label: 'Wedding & event drivers',
    detail: 'Per event — by cars and hours',
    price: 'On call',
  },
];

/* --------------------------------------------------------------- packages  */

/** Options shown in the booking form's package select. Values are stored in Firestore. */
export const bookingPackages = [
  /* The values are stored ids that firestore.rules checks — they never change, even
     when a price does ('1-hour-300' stays '1-hour-300'). Only the labels follow
     site-settings.ts. */
  { value: '1-hour-300', label: `1 Hour — ${priceText.oneHour}` },
  { value: '3-hours-600', label: `3 Hours — ${priceText.threeHours} (most popular)` },
  { value: 'local-full-day', label: `Local Full Day, 8 hrs — ${priceText.fullDay}` },
  { value: 'outstation', label: `Outstation Trip — ${priceText.outstation}` },
  { value: 'night-driver', label: `Night Driver, 8 PM – 6 AM — from ${priceText.nightFrom}` },
  { value: 'medical-emergency', label: 'Hospital / Emergency — priority' },
  { value: 'monthly-basic', label: `Monthly Driver, Basic plan — ${priceText.basic} a month` },
  { value: 'monthly-premium', label: `Monthly Driver, Premium plan — ${priceText.premium} a month` },
  { value: 'wedding-event', label: 'Wedding / Event Drivers — quoted on call' },
  { value: 'one-way-drop', label: 'One-Way Car Drop — quoted on call' },
] as const;

/* ------------------------------------------------------------------ trust  */

export const pillars = [
  {
    step: '01',
    icon: 'shield' as IconName,
    title: 'Police verified',
    body: 'Government ID and a criminal background check on every driver. Documents verified before onboarding, with no exceptions.',
  },
  {
    step: '02',
    icon: 'noAlcohol' as IconName,
    title: 'Zero alcohol policy',
    body: 'A breathalyser test before every single shift. One violation means a permanent ban from the platform.',
  },
  {
    step: '03',
    icon: 'certificate' as IconName,
    title: 'Professionally trained',
    body: 'Defensive driving, first aid and customer service certification are mandatory before a driver takes a booking.',
  },
  {
    step: '04',
    icon: 'star' as IconName,
    title: '5+ years experience',
    body: 'A minimum of five years of professional driving, with local routes already mastered.',
  },
];

/* Every entry here has to be a fact the business can stand behind if asked, not a
   number that sounds good. "500+ families served" and "4.9★ average rating" used
   to sit in this array and were both invented; the audit script now fails the
   build on that shape of claim. The first two are what render beside the booking
   form (`stats.slice(0, 2)` in app/page.tsx), so immediacy leads. */
export const stats = [
  { value: '30 min', label: 'Arrival target' },
  { value: '24/7', label: 'Always available' },
  { value: '4 cities', label: 'Raipur, Bhilai, Durg & Bilaspur' },
  { value: priceText.oneHour, label: 'Starting rate, one hour' },
];

/* ------------------------------------------------------------------ cities */

export type City = {
  slug: string;
  name: string;
  /** City-centre coordinates, fed into the LocalBusiness / City JSON-LD `geo`. */
  geo: { lat: number; lng: number };
  badge: string;
  isHq?: boolean;
  short: string;
  intro: string;
  /** City-specific coverage / response-time note. Keeps the four pages genuinely distinct. */
  coverage: string;
  /** What locals book most here. */
  popular: string;
  areas: string[];
  landmarks: string[];
};

export const cities: City[] = [
  {
    slug: 'raipur',
    name: 'Raipur',
    geo: { lat: 21.2514, lng: 81.6296 },
    badge: 'Headquarters',
    isHq: true,
    short: 'State capital HQ — airport, railway station and all major hospitals.',
    intro:
      'Raipur is where DriveBuddy started, and it remains our largest driver pool. Whether it is a 6 AM airport run from Shankar Nagar or a late return from Telibandha, a verified driver is usually 15 to 20 minutes away.',
    coverage:
      'As our headquarters city, Raipur has the deepest roster and the shortest waits — typically 15 to 20 minutes, and often less inside the Ring Road. Airport runs to Mana are our single most frequent booking, so those drivers know the terminal timings well.',
    popular: 'Airport transfers and the daily office commute',
    areas: [
      'Shankar Nagar',
      'Telibandha',
      'Devendra Nagar',
      'Civil Lines',
      'Pandri',
      'Amanaka',
      'Kabir Nagar',
      'VIP Road',
    ],
    landmarks: [
      'Swami Vivekananda Airport',
      'Raipur Junction railway station',
      'AIIMS Raipur',
      'Ambuja City Centre Mall',
      'Marine Drive, Telibandha',
    ],
  },
  {
    slug: 'bhilai',
    name: 'Bhilai',
    geo: { lat: 21.1938, lng: 81.3509 },
    badge: 'Full coverage',
    short: 'Industrial and residential coverage across the Steel City, round the clock.',
    intro:
      'Bhilai runs on shifts, and so do we. Our drivers know the sector road grid and the Steel Plant gate timings, which makes shift changeovers and late-evening returns straightforward.',
    coverage:
      'Coverage spans the full sector grid plus Supela, Smriti Nagar and Junwani. Because so much of Bhilai works to plant shift timings, we keep extra drivers on the 8 PM to 6 AM window — the night booking is genuinely a night service here, not an exception.',
    popular: 'Night safety drivers and shift-change pickups',
    areas: [
      'Sector 1 to Sector 10',
      'Nehru Nagar',
      'Supela',
      'Khursipar',
      'Smriti Nagar',
      'Kohka',
      'Junwani',
    ],
    landmarks: [
      'Bhilai Steel Plant',
      'Sector 9 Hospital',
      'Surya Treasure Island Mall',
      'Maitri Bagh',
      'IIT Bhilai',
    ],
  },
  {
    slug: 'durg',
    name: 'Durg',
    geo: { lat: 21.1904, lng: 81.2849 },
    badge: 'Full coverage',
    short: 'Complete coverage of wards, markets and institutions across Durg.',
    intro:
      'Durg has narrow market lanes and heavy festival traffic, so we assign drivers who navigate it daily. Bookings for the railway station and district hospital are our most frequent here.',
    coverage:
      'We cover Durg city and the Bhilai–Durg corridor as one zone, so a pickup in Padmanabhpur or Mohan Nagar draws from both driver pools. Expect 20 to 25 minutes in normal traffic, longer during festival weeks around Ganjpara.',
    popular: 'Railway station runs and hospital visits',
    areas: [
      'Padmanabhpur',
      'Potiya',
      'Borsi',
      'Shanti Nagar',
      'Ganjpara',
      'Mohan Nagar',
      'Polsaipara',
    ],
    landmarks: [
      'Durg Junction railway station',
      'District Hospital Durg',
      'Bhilai–Durg bypass',
      'Patan Road corridor',
      'Government Engineering College',
    ],
  },
  {
    slug: 'bilaspur',
    name: 'Bilaspur',
    geo: { lat: 22.0797, lng: 82.1409 },
    badge: 'Full coverage',
    short: 'University campuses, medical hubs and all residential colonies.',
    intro:
      'Bilaspur combines a student population with a busy medical corridor. Our drivers handle both — campus runs at odd hours and unhurried hospital journeys with elderly patients.',
    coverage:
      'Vyapar Vihar, Sarkanda, Mangla and Tifra get the quickest response; Koni and the university side add a few minutes. Medical transport is disproportionately what we do here, given CIMS and Apollo, so patient, gentle drivers are the default assignment.',
    popular: 'Medical transport and university campus runs',
    areas: [
      'Vyapar Vihar',
      'Sarkanda',
      'Tifra',
      'Mangla',
      'Torwa',
      'Koni',
      'Nehru Nagar',
    ],
    landmarks: [
      'Bilaspur Junction railway station',
      'CIMS Hospital',
      'Guru Ghasidas University',
      'Apollo Hospital Bilaspur',
      'Bilasa Devi Kevat Airport',
    ],
  },
];

export const cityNames = cities.map((c) => c.name);

export function getCity(slug: string): City | undefined {
  return cities.find((c) => c.slug === slug);
}

/* ------------------------------------------------------------ testimonials */

export const testimonials = [
  {
    quote:
      'The driver arrived in under 25 minutes. Polite, sober, and drove perfectly. My elderly mother felt completely safe the entire time — we will book again.',
    name: 'Ramesh Sahu',
    city: 'Raipur',
    initial: 'R',
  },
  {
    quote:
      'Perfect for hospital visits with elderly parents. The driver waited patiently for three hours without a single complaint. Genuinely professional service.',
    name: 'Anjali Mishra',
    city: 'Bhilai',
    initial: 'A',
  },
  {
    quote:
      'The airport pickup was seamless. The driver tracked my flight and was waiting before I even reached arrivals. Family travel has never been this easy.',
    name: 'Priya Khanna',
    city: 'Durg',
    initial: 'P',
  },
];

/* ---------------------------------------------------------------------- faq */

export type Faq = { q: string; a: string };

/* Ordered by what people ask first. The early questions are also the ones people
   put to Google and AI assistants word for word — "what is a driver on call",
   "how much does a driver cost" — so each answer opens with the direct answer in
   one sentence that still makes sense quoted on its own. */
export const faqs: Faq[] = [
  {
    q: 'What is a driver on call service?',
    a: 'A driver on call — also called a call driver or acting driver — is a professional driver who comes to you and drives your own car, for an hour, a day or longer. DriveBuddy provides verified drivers on call across Raipur, Bhilai, Durg and Bilaspur in Chhattisgarh, 24 hours a day.',
  },
  {
    q: 'How much does it cost to hire a driver?',
    a: `DriveBuddy charges ${priceText.oneHour} for one hour, ${priceText.threeHours} for three hours, ${priceText.fullDay} for a local full day of eight hours and ${priceText.outstation} for an outstation trip; the night driver (8 PM to 6 AM) starts from ${priceText.nightFrom}. A monthly driver is ${priceText.basic} a month on the Basic plan or ${priceText.premium} on Premium; wedding drivers and one-way car drops are quoted on the call. These are the driver’s charges only — you provide the car and fuel.`,
  },
  {
    q: 'How quickly will a driver arrive?',
    a: 'We guarantee a driver at your location within 30 minutes anywhere in Raipur, Bhilai, Durg or Bilaspur. In practice it is usually 15 to 20 minutes, depending on traffic and the time of day.',
  },
  {
    q: 'Is the service available at night?',
    a: `Yes. DriveBuddy operates 24 hours a day, 7 days a week. Our dedicated night safety driver service runs from 8 PM to 6 AM, starting from ${priceText.nightFrom}, and is widely used by women travelling alone, families and late-finishing office staff.`,
  },
  {
    q: 'What is the difference between Local and Outstation?',
    a: `Local Full Day (${priceText.fullDay}) covers eight hours of driving inside city limits. Outstation (${priceText.outstation}) is for journeys beyond the city, on highways, and can include an overnight halt. Call us on ${phone} for a precise quote on long trips.`,
  },
  {
    q: 'What if I need to extend my booking?',
    a: 'Just tell the driver, or call us. Extensions are charged per hour at the same rate, and the driver stays until the job is finished. There is no penalty for extending.',
  },
  {
    q: 'How are your drivers verified?',
    a: 'Every driver clears a four-stage check: government ID verification, a police background check, a breathalyser test before each shift, and a minimum of five years of professional driving experience.',
  },
  {
    q: 'Which payment methods do you accept?',
    a: 'Cash, UPI (GPay, PhonePe, Paytm) and bank transfer. Rates are fixed at the time of booking, with no surge pricing and no hidden charges.',
  },
  {
    q: 'Can I book for a hospital emergency?',
    a: `Yes, and these get absolute priority. For an emergency, call ${phone} directly rather than using the form — that routes straight to instant dispatch.`,
  },
  {
    q: 'Do I need to provide the car?',
    a: 'Yes. DriveBuddy provides the driver, not the vehicle. You keep your own car, your own insurance and your own comfort — we simply supply someone trustworthy to drive it.',
  },
  {
    q: 'Can I hire a monthly or permanent driver?',
    a: `Yes. Choose the Basic plan at ${priceText.basic} a month${m.joiningFeePercent > 0 ? ` (plus a one-time joining fee of ${priceText.joiningFeePercent} of one month)` : ''} or Premium at ${priceText.premium} a month, which adds free stand-in drivers and a new driver ${priceText.replacement} if yours quits. Both cover ${m.hoursPerDay} hours a day with ${m.daysOffPerMonth} ${day(m.daysOffPerMonth)} off a month.`,
  },
  {
    q: 'Do you provide drivers for weddings and events?',
    a: 'Yes — for the baraat and family cars, guest pickups from the station and airport, and drops after a late function. Tell us the date, the number of cars and the timings, and we quote the whole event.',
  },
  {
    q: 'Can a driver take my car to another city one way?',
    a: 'Yes. With a one-way car drop, a verified driver delivers your car to the address you give and makes their own way back. The price we quote covers the driver’s return.',
  },
  {
    q: 'Do you serve places outside Raipur, Bhilai, Durg and Bilaspur?',
    a: `Pickups are in these four cities. Outstation trips and one-way car drops start from any of them and can go anywhere in Chhattisgarh and beyond — call ${phone} for a quote on the full journey.`,
  },
  {
    q: 'How does the online booking form work?',
    a: 'Fill in your pickup, package and phone number, then submit. The request is saved and our dispatch team is notified immediately. We call you back within a few minutes to confirm the driver and arrival time.',
  },
];

/* ------------------------------------------------------- driver recruitment */

export const driverPerks = [
  {
    icon: 'wallet' as IconName,
    title: 'Reliable weekly payouts',
    body: 'Earnings are settled weekly with a clear statement of every booking. No arbitrary deductions.',
  },
  {
    icon: 'clock' as IconName,
    title: 'Choose your own shifts',
    body: 'Work mornings, evenings or the night window. Tell us your availability and we assign bookings around it.',
  },
  {
    icon: 'mapPin' as IconName,
    title: 'Work near home',
    body: 'Bookings are matched to your city and preferred zones, so you spend less time travelling unpaid.',
  },
  {
    icon: 'certificate' as IconName,
    title: 'Free training and certification',
    body: 'Defensive driving and first aid training at no cost, plus a certification that stays with you.',
  },
];

export const driverRequirements = [
  'A valid commercial driving licence',
  'At least 5 years of driving experience',
  'A clean police record and verifiable government ID',
  'Comfortable with both manual and automatic vehicles',
  'A smartphone with an active number',
  'No history of drink driving — the policy is absolute',
];
