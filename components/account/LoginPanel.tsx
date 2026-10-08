'use client';

import type { ConfirmationResult } from 'firebase/auth';
import { useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { authErrorMessage, confirmLoginCode, sendLoginCode, signInWithGoogle } from '@/lib/auth';
import { normalisePhone, validatePhone } from '@/lib/validate';

/** The 'G' mark, drawn rather than loaded, so the button needs no third-party request. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  );
}

/**
 * Phone + SMS code, or Google. `googleOnly` is the admin panel, where the
 * account's verified email is what grants access.
 */
export function LoginPanel({ googleOnly = false, onDone }: { googleOnly?: boolean; onDone?: () => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState<'send' | 'verify' | 'google' | null>(null);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const problem = validatePhone(phone);
    setFieldError(problem);
    if (problem) return;
    setError('');
    setBusy('send');
    try {
      setConfirmation(await sendLoginCode(normalisePhone(phone), 'login-recaptcha'));
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmation) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setFieldError('Enter the 6-digit code from the SMS.');
      return;
    }
    setFieldError(undefined);
    setError('');
    setBusy('verify');
    try {
      await confirmLoginCode(confirmation, code);
      onDone?.();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function google() {
    setError('');
    setBusy('google');
    try {
      await signInWithGoogle();
      onDone?.();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
    <div className="flex flex-col gap-6">
      {error && <Alert tone="error">{error}</Alert>}

      {!googleOnly &&
        (confirmation ? (
          <form onSubmit={verify} noValidate className="flex flex-col gap-4">
            <p className="text-fg-muted text-[0.9375rem]">
              We sent a 6-digit code by SMS to <strong className="text-fg">+91 {normalisePhone(phone)}</strong>.
            </p>
            <Field label="Code from SMS" name="code" error={fieldError} required>
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  autoFocus
                />
              )}
            </Field>
            <Button type="submit" size="lg" fullWidth loading={busy === 'verify'} loadingText="Checking…">
              Verify and log in
            </Button>
            <button
              type="button"
              className="text-fg-muted self-start text-sm underline underline-offset-4"
              onClick={() => {
                setConfirmation(null);
                setCode('');
              }}
            >
              Change number or send a new code
            </button>
          </form>
        ) : (
          <form onSubmit={send} noValidate className="flex flex-col gap-4">
            <Field label="Mobile number" name="phone" error={fieldError} hint="We'll send a 6-digit code by SMS." required>
              {(p) => (
                <Input
                  {...p}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="10-digit mobile number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" size="lg" fullWidth loading={busy === 'send'} loadingText="Sending code…">
              Send code
            </Button>
          </form>
        ))}

      {!googleOnly && (
        <div className="text-fg-subtle flex items-center gap-3 text-sm" aria-hidden="true">
          <span className="bg-border h-px flex-1" />
          or
          <span className="bg-border h-px flex-1" />
        </div>
      )}

      <Button variant="outline" size="lg" fullWidth onClick={google} loading={busy === 'google'} loadingText="Opening Google…">
        <GoogleMark />
        Continue with Google
      </Button>
    </div>
    {/* Firebase's invisible reCAPTCHA renders here; it stops bots sending SMS on our bill. */}
    {!googleOnly && <div id="login-recaptcha" />}
    </>
  );
}
