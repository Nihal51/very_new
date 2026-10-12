/**
 * The partner program shown on /partners/. Set up with the owner on 11 Oct 2026
 * as a 4-week pilot; the reward amounts live in site-settings.ts (`partners`), so
 * changing a reward there changes every sentence below.
 *
 * Hospitals, clinics and housing societies get no cash on purpose: they usually
 * cannot take money for sending patients or residents anywhere, so their families
 * get a discount instead.
 */

import type { IconName } from '@/components/icons';
import { type Faq } from './content';
import { priceText } from './settings';
import { site } from './site';

export type PartnerType = {
  id: string;
  icon: IconName;
  title: string;
  /** Who this covers, in the partner's own words. */
  who: string;
  /** Why their customers need a driver. */
  need: string;
  customersGet: string;
  partnerGets: string;
};

export const partnerTypes: readonly PartnerType[] = [
  {
    id: 'showrooms',
    icon: 'steering',
    title: 'Car showrooms',
    who: 'Sales teams at new and used car showrooms',
    need: 'Many buyers want the car but not the driving: senior citizens, busy business owners and families whose driver has left.',
    customersGet: 'A driver to bring the new car home on delivery day, and a monthly driver from day one.',
    partnerGets: `${priceText.partnerMonthly} for every buyer who takes a monthly driver.`,
  },
  {
    id: 'hospitals',
    icon: 'heart',
    title: 'Hospitals and clinics',
    who: 'Hospitals, dialysis and physiotherapy centres, nursing homes and senior-care centres',
    need: 'The person who usually drives is often the patient, or is staying by the bed.',
    customersGet: `A calm driver for discharge day and repeat visits, waiting time included, and ${priceText.partnerDiscount} off the monthly joining fee.`,
    partnerGets: 'No cash: a trusted service for your patients, with nothing for your staff to manage.',
  },
  {
    id: 'events',
    icon: 'calendar',
    title: 'Weddings and events',
    who: 'Wedding planners, banquet halls and event managers',
    need: 'A function needs many drivers at once: the baraat, guest pickups and late-night drops.',
    customersGet: 'Drivers for their own cars, or any car with our driver (sedan, SUV or luxury), in one fixed quote agreed before the day.',
    partnerGets: `${priceText.partnerCommission} of every booking you send, about ${priceText.partnerCommissionFullDay} per driver per day, and more when we also bring the car.`,
  },
  {
    id: 'hotels',
    icon: 'building',
    title: 'Hotels and travel agents',
    who: 'Hotels, guest houses and travel agents',
    need: 'Guests who came in their own car often don’t want to drive in a new city, or after a long journey.',
    customersGet: 'A verified driver for a full day in the city, an outstation trip or an airport run.',
    partnerGets: `${priceText.partnerCommission} of every full-day, outstation or event booking, and ${priceText.partnerMonthly} per monthly customer.`,
  },
  {
    id: 'societies',
    icon: 'mapPin',
    title: 'Housing societies',
    who: 'Residents’ welfare associations and society committees',
    need: 'Senior citizens who no longer drive, families whose driver is on leave, and late-night returns.',
    customersGet: `A verified driver by the hour, for the night or every month, and ${priceText.partnerDiscount} off the monthly joining fee.`,
    partnerGets: 'No cash: a useful service for residents, with nothing for the committee to manage.',
  },
];

export const partnerSteps = [
  {
    title: 'Tell us you’re in',
    body: 'Send us a WhatsApp or call. We note your business name; there is nothing to sign and no fee.',
  },
  {
    title: 'Send customers our way',
    body: 'Share our number or card. The customer mentions your name when they call, and we write it on the booking.',
  },
  {
    title: 'We do the rest',
    body: 'We send a police-verified driver. Cash rewards are paid by UPI once the customer has paid; discounts come straight off the customer’s bill.',
  },
] as const;

export const partnerFaqs: Faq[] = [
  {
    q: 'Is there a fee to become a DriveBuddy partner?',
    a: 'No. There is nothing to pay and nothing to sign, and there are no targets. You earn only when a customer you sent books and pays.',
  },
  {
    q: 'How do you know a customer came from me?',
    a: 'The customer mentions your name or your business when they call or message us, and we write it on the booking. You can also message us their name and number yourself.',
  },
  {
    q: 'When and how is the reward paid?',
    a: `By UPI, once the customer you sent has paid. For a monthly driver, that is after their first month is paid. Rewards: ${priceText.partnerMonthly} per monthly customer for showrooms, hotels and travel agents; ${priceText.partnerCommission} of every full-day or outstation booking for hotels and travel agents; ${priceText.partnerCommission} of every wedding or event booking for wedding planners and banquet halls.`,
  },
  {
    q: 'Why don’t hospitals and housing societies get cash?',
    a: `Most hospitals, clinics and societies can’t accept money for sending patients or residents to a service. So the family gets the benefit instead: ${priceText.partnerDiscount} off the joining fee on a monthly driver.`,
  },
  {
    q: 'Which areas does the partner program cover?',
    a: `Everywhere we send drivers: Raipur, Bhilai, Durg and Bilaspur, and the nearby towns of Naya Raipur, Arang, Abhanpur, Kumhari and Tilda-Neora, all in ${site.region}.`,
  },
];

export const partnerWhatsapp =
  'Hi DriveBuddy, I want to become a partner.\nBusiness name:\nType (showroom / hospital or clinic / wedding or events / hotel or travel / housing society):\nArea:\nMy name:';
