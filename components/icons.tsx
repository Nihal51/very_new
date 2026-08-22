/**
 * Inline SVG icon set. Hand-rolled so the site carries no icon dependency.
 * Every icon: 24x24 viewBox, 1.5 stroke, currentColor, aria-hidden.
 * Size with Tailwind classes (`className="size-5"`).
 */

import type { SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg {...base} {...props}>
      {children}
    </svg>
  );
}

export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.75 4.75 5.5v5.4c0 4.6 3 8.3 7.25 10.35 4.25-2.05 7.25-5.75 7.25-10.35V5.5L12 2.75Z" />
    <path d="m9.25 11.75 2 2 3.5-3.75" />
  </Svg>
);

export const SteeringIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.25" />
    <circle cx="12" cy="12" r="2.75" />
    <path d="M12 14.75V21.25M9.4 11.2 3.1 9.6M14.6 11.2l6.3-1.6" />
  </Svg>
);

export const HeartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20.25s-7.75-4.6-7.75-9.6a4.4 4.4 0 0 1 7.75-2.85A4.4 4.4 0 0 1 19.75 10.65c0 5-7.75 9.6-7.75 9.6Z" />
  </Svg>
);

export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.4A8.4 8.4 0 0 1 9.6 4a8.75 8.75 0 1 0 10.4 10.4Z" />
  </Svg>
);

export const PlaneIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.2 12.6 3.5 10.8a.6.6 0 0 1-.15-1.1l1.6-.95a1.5 1.5 0 0 1 1.15-.16l3.4.9 4.3-3.9a2.6 2.6 0 0 1 3.6.1l.35.35a2.6 2.6 0 0 1 .1 3.6l-3.9 4.3.9 3.4a1.5 1.5 0 0 1-.16 1.15l-.95 1.6a.6.6 0 0 1-1.1-.15l-1.8-6.7" />
  </Svg>
);

export const NoAlcoholIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3.75h8l-.6 4.1A4 4 0 0 1 12 11.25a4 4 0 0 1-3.4-3.4L8 3.75ZM12 11.25v9M9 20.25h6" />
    <path d="M3.5 3.5 20.5 20.5" strokeWidth="1.75" />
  </Svg>
);

export const CertificateIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="9.25" r="5.5" />
    <path d="m9.4 9.1 1.75 1.75 3.45-3.5" />
    <path d="M8.6 14.1 7.5 21l4.5-2.4 4.5 2.4-1.1-6.9" />
  </Svg>
);

export const StarIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m12 3.5 2.65 5.4 5.95.85-4.3 4.2 1 5.9L12 17.05l-5.3 2.8 1-5.9-4.3-4.2 5.95-.85L12 3.5Z" />
  </Svg>
);

export const StarFilledIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false" {...p}>
    <path d="m12 3.5 2.65 5.4 5.95.85-4.3 4.2 1 5.9L12 17.05l-5.3 2.8 1-5.9-4.3-4.2 5.95-.85L12 3.5Z" />
  </svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.25" />
    <path d="M12 7.25V12l3.25 2" />
  </Svg>
);

export const MapPinIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21.25c3.75-4.1 5.75-7.15 5.75-9.85A5.75 5.75 0 0 0 6.25 11.4c0 2.7 2 5.75 5.75 9.85Z" />
    <circle cx="12" cy="11.1" r="2.25" />
  </Svg>
);

export const PhoneIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.4 3.75h2.1l1.5 3.8-1.9 1.4a11.5 11.5 0 0 0 5.95 5.95l1.4-1.9 3.8 1.5v2.1a2.65 2.65 0 0 1-2.9 2.65C10.4 18.6 5.4 13.6 3.75 6.65A2.65 2.65 0 0 1 6.4 3.75Z" />
  </Svg>
);

export const WhatsappIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false" {...p}>
    <path d="M12.04 2.25a9.6 9.6 0 0 0-8.2 14.62L2.3 21.75l4.99-1.5a9.6 9.6 0 1 0 4.75-18ZM12.04 4.1a7.75 7.75 0 1 1-3.98 14.4l-.32-.19-2.72.82.8-2.66-.2-.33A7.75 7.75 0 0 1 12.04 4.1Zm-3.3 3.86c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.06 0 1.21.88 2.38 1 2.55.13.16 1.72 2.74 4.26 3.73 2.11.82 2.54.66 3 .61.46-.04 1.48-.6 1.69-1.19.2-.58.2-1.08.14-1.19-.06-.1-.23-.16-.48-.28-.25-.13-1.48-.73-1.71-.81-.23-.09-.4-.13-.56.12-.17.25-.65.83-.8 1-.14.17-.29.19-.54.06-.25-.12-1.06-.39-2.02-1.25-.75-.67-1.25-1.49-1.4-1.74-.14-.25-.01-.39.11-.51.11-.11.25-.29.37-.44.13-.14.17-.25.25-.41.09-.17.05-.31-.01-.44-.06-.12-.55-1.35-.76-1.84-.2-.48-.4-.42-.55-.43h-.44Z" />
  </svg>
);

export const MailIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.75" y="4.75" width="18.5" height="14.5" rx="2.25" />
    <path d="m3.5 6.5 8.5 6 8.5-6" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4.75 12.5 4.5 4.5 10-10.5" />
  </Svg>
);

export const CheckCircleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.25" />
    <path d="m8.25 12.25 2.5 2.5 5-5.5" />
  </Svg>
);

export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.25" />
    <path d="M12 7.75v5M12 15.75v.5" />
  </Svg>
);

export const InfoIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.25" />
    <path d="M12 11.25v5M12 7.75v.5" />
  </Svg>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.75 12h14.5m-5.5-5.5L19.25 12l-5.5 5.5" />
  </Svg>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.25 12H4.75m5.5-5.5L4.75 12l5.5 5.5" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6.25 9.5 5.75 5.5 5.75-5.5" />
  </Svg>
);

export const MenuIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const WalletIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.75" y="5.75" width="18.5" height="13.5" rx="2.5" />
    <path d="M2.75 10.25h18.5" />
    <path d="M16.5 15h1.75" />
  </Svg>
);

export const UserIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8.25" r="3.75" />
    <path d="M4.75 20.25a7.25 7.25 0 0 1 14.5 0" />
  </Svg>
);

export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.75" y="5.75" width="16.5" height="14.5" rx="2.25" />
    <path d="M3.75 10.25h16.5M8.5 3.75v3.5M15.5 3.75v3.5" />
  </Svg>
);

export const RouteIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6.25" cy="6.25" r="2.5" />
    <circle cx="17.75" cy="17.75" r="2.5" />
    <path d="M8.75 6.25h5a3.5 3.5 0 0 1 0 7h-3.5a3.5 3.5 0 0 0 0 7h5" />
  </Svg>
);

export const BuildingIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.75 20.25V5.5a1.75 1.75 0 0 1 1.75-1.75h6a1.75 1.75 0 0 1 1.75 1.75v14.75" />
    <path d="M14.25 9.75h3.25a1.75 1.75 0 0 1 1.75 1.75v8.75M3 20.25h18M8 8h2.5M8 12h2.5M8 16h2.5" />
  </Svg>
);

/* -------------------------------------------------------------------------- */

/** Name-addressable registry, so content data can reference icons by string. */
export const icons = {
  shield: ShieldIcon,
  steering: SteeringIcon,
  heart: HeartIcon,
  moon: MoonIcon,
  plane: PlaneIcon,
  noAlcohol: NoAlcoholIcon,
  certificate: CertificateIcon,
  star: StarIcon,
  starFilled: StarFilledIcon,
  clock: ClockIcon,
  mapPin: MapPinIcon,
  phone: PhoneIcon,
  whatsapp: WhatsappIcon,
  mail: MailIcon,
  check: CheckIcon,
  checkCircle: CheckCircleIcon,
  alert: AlertIcon,
  info: InfoIcon,
  arrowRight: ArrowRightIcon,
  arrowLeft: ArrowLeftIcon,
  chevronDown: ChevronDownIcon,
  menu: MenuIcon,
  close: CloseIcon,
  wallet: WalletIcon,
  user: UserIcon,
  calendar: CalendarIcon,
  route: RouteIcon,
  building: BuildingIcon,
} as const;

export type IconName = keyof typeof icons;

/** Render an icon by name: `<Icon name="shield" className="size-5" />`. */
export function Icon({ name, ...props }: IconProps & { name: IconName }) {
  const Cmp = icons[name];
  return <Cmp {...props} />;
}
