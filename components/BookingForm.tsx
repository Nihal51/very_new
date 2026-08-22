'use client';

import { useEffect, useRef, useState, type ElementType } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button, ButtonAnchor } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { CheckCircleIcon, PhoneIcon, WhatsappIcon } from '@/components/icons';
import { bookingPackages, cities } from '@/lib/content';
import { submitDoc } from '@/lib/firebase';
import { cn } from '@/lib/cn';
import { formatPhone, site, telHref, waHref } from '@/lib/site';
import {
  firstErrorField,
  isClean,
  normalisePhone,
  validateAddress,
  validateName,
  validateOptionalText,
  validatePhone,
  validateRequired,
} from '@/lib/validate';

type Values = {
  name: string;
  phone: string;
  city: string;
  pkg: string;
  pickup: string;
  when: string;
  notes: string;
};

type Errors = Partial<Record<keyof Values, string>>;
type Status = 'idle' | 'submitting' | 'success' | 'error';

const EMPTY: Values = {
  name: '',
  phone: '',
  city: '',
  pkg: '',
  pickup: '',
  when: '',
  notes: '',
};

/** Visual order — also the order we hunt for the first invalid field on submit. */
const ORDER = ['name', 'phone', 'city', 'pkg', 'pickup', 'when', 'notes'] as const;

function validateField(key: keyof Values, values: Values): string | undefined {
  switch (key) {
    case 'name':
      return validateName(values.name);
    case 'phone':
      return validatePhone(values.phone);
    case 'city':
      return validateRequired(values.city, 'your city');
    case 'pkg':
      return validateRequired(values.pkg, 'a service');
    case 'pickup':
      return validateAddress(values.pickup);
    case 'notes':
      return validateOptionalText(values.notes, 500);
    default:
      return undefined;
  }
}

function packageLabel(value: string): string {
  return bookingPackages.find((p) => p.value === value)?.label ?? value;
}

/** Everything the customer typed, as a WhatsApp message — the outage fallback. */
function whatsappMessage(v: Values): string {
  return [
    `Hi ${site.name}, I would like to book a driver.`,
    '',
    `Name: ${v.name}`,
    `Mobile: ${normalisePhone(v.phone) || v.phone}`,
    `City: ${v.city}`,
    `Service: ${packageLabel(v.pkg)}`,
    `Pickup: ${v.pickup}`,
    v.when ? `Preferred time: ${v.when.replace('T', ' ')}` : null,
    v.notes ? `Notes: ${v.notes}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

export function BookingForm({
  id = 'booking-form',
  className,
  headingLevel = 'h2',
  title = 'Book a verified driver',
  lede = 'Fill this in and we call you back within minutes to confirm your driver.',
}: {
  id?: string;
  className?: string;
  headingLevel?: 'h2' | 'h3';
  title?: string;
  lede?: string;
}) {
  const Heading = headingLevel as ElementType;

  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof Values, boolean>>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [failureMessage, setFailureMessage] = useState('');
  const [submitted, setSubmitted] = useState<Values>(EMPTY);

  const formRef = useRef<HTMLFormElement>(null);
  const successRef = useRef<HTMLDivElement>(null);

  // Move focus to the confirmation so screen reader and keyboard users land on it.
  useEffect(() => {
    if (status === 'success') successRef.current?.focus();
  }, [status]);

  const set = (key: keyof Values) => (value: string) => {
    const next = { ...values, [key]: value };
    setValues(next);
    // Once a field has been touched, clear its error as soon as it becomes valid.
    if (touched[key]) {
      setErrors((e) => ({ ...e, [key]: validateField(key, next) }));
    }
  };

  const blur = (key: keyof Values) => () => {
    setTouched((t) => ({ ...t, [key]: true }));
    setErrors((e) => ({ ...e, [key]: validateField(key, values) }));
  };

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === 'submitting') return; // double-submit guard

    const next: Errors = {};
    for (const key of ORDER) next[key] = validateField(key, values);
    setErrors(next);
    setTouched(Object.fromEntries(ORDER.map((k) => [k, true])));

    if (!isClean(next)) {
      const first = firstErrorField(next, ORDER);
      if (first) {
        formRef.current
          ?.querySelector<HTMLElement>(`[name="${first}"]`)
          ?.focus();
      }
      return;
    }

    setStatus('submitting');
    const result = await submitDoc('bookings', {
      name: values.name.trim(),
      phone: normalisePhone(values.phone),
      city: values.city,
      package: values.pkg,
      pickup: values.pickup.trim(),
      preferredTime: values.when || '',
      notes: values.notes.trim(),
    });

    if (result.ok) {
      setSubmitted(values);
      setStatus('success');
      setValues(EMPTY);
      setTouched({});
      setErrors({});
    } else {
      setFailureMessage(result.message);
      setStatus('error');
    }
  }

  /* ------------------------------------------------------------- success -- */

  if (status === 'success') {
    return (
      <Card id={id} className={cn('scroll-mt-28', className)}>
        <div ref={successRef} tabIndex={-1} className="focus:outline-none">
          <span className="bg-success-subtle text-success flex size-12 items-center justify-center rounded-full">
            <CheckCircleIcon className="size-7" />
          </span>

          <Heading className="text-display-sm mt-5">Booking request received</Heading>
          <p className="text-fg-muted mt-2 text-[0.9375rem]">
            Thanks {submitted.name.split(' ')[0]} — our dispatch team has your request and
            will call you on{' '}
            <span className="tabular text-fg font-semibold">
              {formatPhone(normalisePhone(submitted.phone))}
            </span>{' '}
            within a few minutes to confirm your driver.
          </p>

          <dl className="border-border bg-bg-subtle mt-6 grid gap-x-6 gap-y-3 rounded-xl border p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-fg-subtle">Service</dt>
              <dd className="mt-0.5 font-semibold">{packageLabel(submitted.pkg)}</dd>
            </div>
            <div>
              <dt className="text-fg-subtle">City</dt>
              <dd className="mt-0.5 font-semibold">{submitted.city}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-fg-subtle">Pickup</dt>
              <dd className="mt-0.5 font-semibold">{submitted.pickup}</dd>
            </div>
            {submitted.when && (
              <div className="sm:col-span-2">
                <dt className="text-fg-subtle">Preferred time</dt>
                <dd className="tabular mt-0.5 font-semibold">
                  {submitted.when.replace('T', ' at ')}
                </dd>
              </div>
            )}
          </dl>

          <p className="text-fg-subtle mt-5 text-sm">
            Need it sooner, or something to add? Reach us directly — we are available 24/7.
          </p>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <ButtonAnchor href={telHref} fullWidth className="sm:w-auto">
              <PhoneIcon className="size-4" />
              Call {formatPhone(site.phone)}
            </ButtonAnchor>
            <ButtonAnchor
              href={waHref(whatsappMessage(submitted))}
              target="_blank"
              rel="noopener noreferrer"
              variant="outline"
              fullWidth
              className="sm:w-auto"
            >
              <WhatsappIcon className="size-4" />
              Send on WhatsApp too
            </ButtonAnchor>
          </div>

          <button
            type="button"
            onClick={() => setStatus('idle')}
            className="text-fg-subtle hover:text-fg mt-5 rounded-lg text-sm font-medium underline underline-offset-4"
          >
            Make another booking
          </button>
        </div>
      </Card>
    );
  }

  /* ---------------------------------------------------------------- form -- */

  const submitting = status === 'submitting';

  return (
    <Card id={id} className={cn('scroll-mt-28', className)}>
      <Heading className="text-display-sm">{title}</Heading>
      <p className="text-fg-muted mt-2 text-[0.9375rem]">{lede}</p>

      <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-6">
        {/* Disabling the fieldset freezes every control while the write is in flight. */}
        <fieldset disabled={submitting} className="m-0 min-w-0 border-0 p-0">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Your name" name="name" required error={errors.name}>
              {(p) => (
                <Input
                  {...p}
                  type="text"
                  autoComplete="name"
                  placeholder="e.g. Ramesh Sahu"
                  value={values.name}
                  onChange={(e) => set('name')(e.target.value)}
                  onBlur={blur('name')}
                />
              )}
            </Field>

            <Field
              label="Mobile number"
              name="phone"
              required
              error={errors.phone}
              hint="We call this number to confirm."
            >
              {(p) => (
                <Input
                  {...p}
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={14}
                  placeholder="10-digit mobile"
                  value={values.phone}
                  onChange={(e) => set('phone')(e.target.value)}
                  onBlur={blur('phone')}
                />
              )}
            </Field>

            <Field label="City" name="city" required error={errors.city}>
              {(p) => (
                <Select
                  {...p}
                  value={values.city}
                  onChange={(e) => set('city')(e.target.value)}
                  onBlur={blur('city')}
                >
                  <option value="">Select your city</option>
                  {cities.map((c) => (
                    <option key={c.slug} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Service needed" name="pkg" required error={errors.pkg}>
              {(p) => (
                <Select
                  {...p}
                  value={values.pkg}
                  onChange={(e) => set('pkg')(e.target.value)}
                  onBlur={blur('pkg')}
                >
                  <option value="">Select a service</option>
                  {bookingPackages.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label="Pickup address"
              name="pickup"
              required
              error={errors.pickup}
              className="sm:col-span-2"
            >
              {(p) => (
                <Input
                  {...p}
                  type="text"
                  autoComplete="street-address"
                  placeholder="House / street, area, landmark"
                  value={values.pickup}
                  onChange={(e) => set('pickup')(e.target.value)}
                  onBlur={blur('pickup')}
                />
              )}
            </Field>

            <Field
              label="Preferred date & time"
              name="when"
              optionalLabel
              hint="Leave blank if you need a driver now."
            >
              {(p) => (
                <Input
                  {...p}
                  type="datetime-local"
                  value={values.when}
                  onChange={(e) => set('when')(e.target.value)}
                />
              )}
            </Field>

            <Field
              label="Anything else?"
              name="notes"
              optionalLabel
              error={errors.notes}
              hint="Automatic car, hospital visit, extra stops…"
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  maxLength={500}
                  value={values.notes}
                  onChange={(e) => set('notes')(e.target.value)}
                  onBlur={blur('notes')}
                />
              )}
            </Field>
          </div>

          {status === 'error' && (
            <Alert tone="error" title="We could not save that" className="mt-6">
              <p>{failureMessage}</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <ButtonAnchor
                  href={waHref(whatsappMessage(values))}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="sm"
                >
                  <WhatsappIcon className="size-4" />
                  Send on WhatsApp
                </ButtonAnchor>
                <ButtonAnchor href={telHref} variant="outline" size="sm">
                  <PhoneIcon className="size-4" />
                  Call {formatPhone(site.phone)}
                </ButtonAnchor>
              </div>
            </Alert>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              type="submit"
              size="lg"
              loading={submitting}
              loadingText="Sending…"
              className="w-full sm:w-auto"
            >
              {status === 'error' ? 'Try again' : 'Request my driver'}
            </Button>
            <p className="text-fg-subtle text-sm">
              No payment now. We confirm on call before dispatching.
            </p>
          </div>
        </fieldset>

        {/* Politely announces progress without stealing focus. */}
        <p aria-live="polite" className="sr-only">
          {submitting ? 'Sending your booking request.' : ''}
        </p>
      </form>
    </Card>
  );
}
