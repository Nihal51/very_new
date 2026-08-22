'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Button, ButtonAnchor } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { CheckCircleIcon, PhoneIcon, WhatsappIcon } from '@/components/icons';
import { cities } from '@/lib/content';
import { submitDoc } from '@/lib/firebase';
import { formatPhone, site, telHref, waHref } from '@/lib/site';
import {
  firstErrorField,
  isClean,
  normalisePhone,
  validateExperience,
  validateName,
  validateOptionalText,
  validatePhone,
  validateRequired,
} from '@/lib/validate';

type Values = {
  name: string;
  phone: string;
  city: string;
  experience: string;
  licence: string;
  about: string;
};

type Errors = Partial<Record<keyof Values, string>>;
type Status = 'idle' | 'submitting' | 'success' | 'error';

const EMPTY: Values = { name: '', phone: '', city: '', experience: '', licence: '', about: '' };

const ORDER = ['name', 'phone', 'city', 'experience', 'licence', 'about'] as const;

const licenceOptions = [
  { value: 'commercial', label: 'Commercial (badge) licence' },
  { value: 'lmv', label: 'LMV — private licence' },
  { value: 'both', label: 'Both commercial and LMV' },
];

function validateField(key: keyof Values, v: Values): string | undefined {
  switch (key) {
    case 'name':
      return validateName(v.name);
    case 'phone':
      return validatePhone(v.phone);
    case 'city':
      return validateRequired(v.city, 'the city you want to work in');
    case 'experience':
      return validateExperience(v.experience);
    case 'licence':
      return validateRequired(v.licence, 'your licence type');
    case 'about':
      return validateOptionalText(v.about, 500);
  }
}

function licenceLabel(value: string) {
  return licenceOptions.find((o) => o.value === value)?.label ?? value;
}

function whatsappMessage(v: Values): string {
  return [
    `Hi ${site.name}, I would like to apply as a driver.`,
    '',
    `Name: ${v.name}`,
    `Mobile: ${normalisePhone(v.phone) || v.phone}`,
    `City: ${v.city}`,
    `Experience: ${v.experience} years`,
    `Licence: ${licenceLabel(v.licence)}`,
    v.about ? `About: ${v.about}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

export function DriverForm({ id = 'driver-form' }: { id?: string }) {
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof Values, boolean>>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [failureMessage, setFailureMessage] = useState('');
  const [submittedName, setSubmittedName] = useState('');

  const formRef = useRef<HTMLFormElement>(null);
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === 'success') successRef.current?.focus();
  }, [status]);

  const set = (key: keyof Values) => (value: string) => {
    const next = { ...values, [key]: value };
    setValues(next);
    if (touched[key]) setErrors((e) => ({ ...e, [key]: validateField(key, next) }));
  };

  const blur = (key: keyof Values) => () => {
    setTouched((t) => ({ ...t, [key]: true }));
    setErrors((e) => ({ ...e, [key]: validateField(key, values) }));
  };

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === 'submitting') return;

    const next: Errors = {};
    for (const key of ORDER) next[key] = validateField(key, values);
    setErrors(next);
    setTouched(Object.fromEntries(ORDER.map((k) => [k, true])));

    if (!isClean(next)) {
      const first = firstErrorField(next, ORDER);
      if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }

    setStatus('submitting');
    const result = await submitDoc('drivers', {
      name: values.name.trim(),
      phone: normalisePhone(values.phone),
      city: values.city,
      experienceYears: Number(values.experience),
      licence: values.licence,
      about: values.about.trim(),
    });

    if (result.ok) {
      setSubmittedName(values.name.split(' ')[0] ?? '');
      setStatus('success');
      setValues(EMPTY);
      setTouched({});
      setErrors({});
    } else {
      setFailureMessage(result.message);
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <Card id={id} className="scroll-mt-28">
        <div ref={successRef} tabIndex={-1} className="focus:outline-none">
          <span className="bg-success-subtle text-success flex size-12 items-center justify-center rounded-full">
            <CheckCircleIcon className="size-7" />
          </span>
          <h2 className="text-display-sm mt-5">Application received</h2>
          <p className="text-fg-muted mt-2 text-[0.9375rem]">
            Thanks {submittedName}. Our team reviews applications within two working days and
            will call you to arrange document verification.
          </p>
          <ol className="text-fg-muted mt-5 flex flex-col gap-2 text-sm">
            <li>1. We call you to confirm your details and availability.</li>
            <li>2. Document check — licence, government ID, police verification.</li>
            <li>3. Free defensive driving and first aid training.</li>
            <li>4. Your first booking, in your own city.</li>
          </ol>
          <div className="mt-6">
            <ButtonAnchor href={telHref} variant="outline">
              <PhoneIcon className="size-4" />
              Call us on {formatPhone(site.phone)}
            </ButtonAnchor>
          </div>
        </div>
      </Card>
    );
  }

  const submitting = status === 'submitting';

  return (
    <Card id={id} className="scroll-mt-28">
      <h2 className="text-display-sm">Apply to drive</h2>
      <p className="text-fg-muted mt-2 text-[0.9375rem]">
        Six fields. We call you back within two working days.
      </p>

      <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-6">
        <fieldset disabled={submitting} className="m-0 min-w-0 border-0 p-0">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Full name" name="name" required error={errors.name}>
              {(p) => (
                <Input
                  {...p}
                  type="text"
                  autoComplete="name"
                  placeholder="As printed on your licence"
                  value={values.name}
                  onChange={(e) => set('name')(e.target.value)}
                  onBlur={blur('name')}
                />
              )}
            </Field>

            <Field label="Mobile number" name="phone" required error={errors.phone}>
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

            <Field label="City you want to work in" name="city" required error={errors.city}>
              {(p) => (
                <Select
                  {...p}
                  value={values.city}
                  onChange={(e) => set('city')(e.target.value)}
                  onBlur={blur('city')}
                >
                  <option value="">Select a city</option>
                  {cities.map((c) => (
                    <option key={c.slug} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label="Years of experience"
              name="experience"
              required
              error={errors.experience}
              hint="Minimum 5 years."
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={60}
                  placeholder="e.g. 7"
                  value={values.experience}
                  onChange={(e) => set('experience')(e.target.value)}
                  onBlur={blur('experience')}
                />
              )}
            </Field>

            <Field
              label="Licence type"
              name="licence"
              required
              error={errors.licence}
              className="sm:col-span-2"
            >
              {(p) => (
                <Select
                  {...p}
                  value={values.licence}
                  onChange={(e) => set('licence')(e.target.value)}
                  onBlur={blur('licence')}
                >
                  <option value="">Select your licence</option>
                  {licenceOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label="Anything we should know?"
              name="about"
              optionalLabel
              error={errors.about}
              hint="Vehicle types you are comfortable with, preferred shifts, past employers."
              className="sm:col-span-2"
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={3}
                  maxLength={500}
                  value={values.about}
                  onChange={(e) => set('about')(e.target.value)}
                  onBlur={blur('about')}
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

          <div className="mt-6">
            <Button
              type="submit"
              size="lg"
              loading={submitting}
              loadingText="Sending…"
              className="w-full sm:w-auto"
            >
              {status === 'error' ? 'Try again' : 'Submit application'}
            </Button>
          </div>
        </fieldset>

        <p aria-live="polite" className="sr-only">
          {submitting ? 'Sending your application.' : ''}
        </p>
      </form>
    </Card>
  );
}
