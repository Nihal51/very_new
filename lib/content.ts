/**
 * All marketing content in one place, typed. Pages render from these arrays so
 * copy edits never require touching layout code.
 * Content carried over from the original single-file site.
 */

import type { IconName } from '@/components/icons';

/* ---------------------------------------------------------------- services */

export type Service = {
  slug: string;
  icon: IconName;
  title: string;
  short: string;
  body: string;
  badge?: string;
  includes: string[];
};

export const services: Service[] = [
  {
    slug: 'personal-driver',
    icon: 'steering',
    title: 'Personal Driver',
    short: 'Your car, our driver — errands, school runs and the daily commute.',
    body: 'A verified driver takes the wheel of your own vehicle for as long as you need. Ideal for the daily office commute, school pickups, shopping trips or a day of errands without the parking hassle.',
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
    body: 'A dedicated night shift from 8 PM to 6 AM at a flat rate. Every night driver is police-verified and breath-tested before the shift starts, so a late finish at the office never has to mean an unsafe ride home.',
    badge: 'Popular choice',
    includes: [
      'Flat ₹500 for the 8 PM – 6 AM window',
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
    badge: 'Flight tracked',
    includes: [
      'Live flight tracking for pickups',
      'Meet-and-greet at arrivals',
      'Highway-experienced drivers',
      'Night halts arranged on request',
    ],
  },
];

/* ---------------------------------------------------------------- pricing  */

export type Plan = {
  id: string;
  eyebrow: string;
  name: string;
  blurb: string;
  price: string;
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
    price: '₹300',
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
    price: '₹600',
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
    price: '₹1000–1200',
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
    price: '₹1200–1500',
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
    detail: '8 PM – 6 AM, flat rate',
    price: '₹500',
  },
  {
    label: 'Hospital / emergency',
    detail: 'Priority dispatch — call us directly',
    price: 'On call',
  },
];

/* --------------------------------------------------------------- packages  */

/** Options shown in the booking form's package select. Values are stored in Firestore. */
export const bookingPackages = [
  { value: '1-hour-300', label: '1 Hour — ₹300' },
  { value: '3-hours-600', label: '3 Hours — ₹600 (most popular)' },
  { value: 'local-full-day', label: 'Local Full Day, 8 hrs — ₹1000–1200' },
  { value: 'outstation', label: 'Outstation Trip — ₹1200–1500' },
  { value: 'night-driver', label: 'Night Driver, 8 PM – 6 AM — ₹500' },
  { value: 'medical-emergency', label: 'Hospital / Emergency — priority' },
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

export const stats = [
  { value: '500+', label: 'Families served' },
  { value: '24/7', label: 'Always available' },
  { value: '30 min', label: 'Average response' },
  { value: '4.9★', label: 'Average rating' },
];

/* ------------------------------------------------------------------ cities */

export type City = {
  slug: string;
  name: string;
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

export const faqs: Faq[] = [
  {
    q: 'How quickly will a driver arrive?',
    a: 'We guarantee a driver at your location within 30 minutes anywhere in Raipur, Bhilai, Durg or Bilaspur. In practice it is usually 15 to 20 minutes, depending on traffic and the time of day.',
  },
  {
    q: 'Is the service available at night?',
    a: 'Yes. DriveBuddy operates 24 hours a day, 7 days a week. Our dedicated night safety driver service runs from 8 PM to 6 AM at a flat ₹500, and is widely used by women travelling alone, families and late-finishing office staff.',
  },
  {
    q: 'What is the difference between Local and Outstation?',
    a: 'Local Full Day (₹1000–1200) covers eight hours of driving inside city limits. Outstation (₹1200–1500) is for journeys beyond the city, on highways, and can include an overnight halt. Call us on 9111473929 for a precise quote on long trips.',
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
    a: 'Yes, and these get absolute priority. For an emergency, call 9111473929 directly rather than using the form — that routes straight to instant dispatch.',
  },
  {
    q: 'Do I need to provide the car?',
    a: 'Yes. DriveBuddy provides the driver, not the vehicle. You keep your own car, your own insurance and your own comfort — we simply supply someone trustworthy to drive it.',
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
