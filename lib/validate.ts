/**
 * Form validation shared by the booking and driver forms.
 *
 * Messages are specific and say what to do next — "Enter a 10-digit mobile
 * number so we can call you back" rather than "Invalid input".
 */

/** Indian mobile numbers: 10 digits starting 6–9. */
const MOBILE = /^[6-9]\d{9}$/;

/** Strips spaces, dashes and a leading +91 / 0 before validating. */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export function validateName(value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'Please tell us your name.';
  if (v.length < 2) return 'Your name looks too short — please enter your full name.';
  if (v.length > 60) return 'Please keep your name under 60 characters.';
  return undefined;
}

export function validatePhone(value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'We need a mobile number to confirm your booking.';
  if (!MOBILE.test(normalisePhone(v)))
    return 'Enter a 10-digit mobile number so we can call you back.';
  return undefined;
}

export function validateRequired(value: string, what: string): string | undefined {
  if (!value.trim()) return `Please choose ${what}.`;
  return undefined;
}

export function validateAddress(value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'Enter a pickup address so the driver knows where to reach you.';
  if (v.length < 6) return 'Please add a little more detail — area or landmark helps.';
  if (v.length > 300) return 'Please keep the address under 300 characters.';
  return undefined;
}

export function validateExperience(value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'Enter how many years you have been driving.';
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 'Enter your experience in years, for example 6.';
  if (n < 5) return 'We currently require a minimum of 5 years of driving experience.';
  if (n > 60) return 'Please enter a realistic number of years.';
  return undefined;
}

export function validateOptionalText(value: string, max = 500): string | undefined {
  if (value.trim().length > max) return `Please keep this under ${max} characters.`;
  return undefined;
}

/** True when every value in the error map is undefined. */
export function isClean(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).every((e) => !e);
}

/** First field name that has an error, following the visual order of `order`. */
export function firstErrorField(
  errors: Record<string, string | undefined>,
  order: readonly string[],
): string | undefined {
  return order.find((k) => errors[k]);
}
