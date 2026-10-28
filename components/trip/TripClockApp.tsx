'use client';

import { useEffect, useRef, useState } from 'react';

import { CheckIcon, PhoneIcon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { isFirebaseConfigured } from '@/lib/firebase';
import { prettyPhone } from '@/lib/bookings';
import { settings } from '@/lib/settings';
import { nextStep, stepName, stepsFor, timeText, whenText, type TripLink, type TripStep } from '@/lib/tripclock';
import { currentLoc, tapStep, watchTripLink } from '@/lib/tripclock-db';

/** ?k=demo: a pretend trip that saves nothing — to show a driver how it works. */
const DEMO_KEY = 'demo';

type State = { kind: 'loading' } | { kind: 'ok'; link: TripLink } | { kind: 'missing' } | { kind: 'error' };

/** What to press and when, in Hindi first (most drivers read it best), then English. */
const HINT: Record<TripStep, { hi: string; en: string }> = {
  start: {
    hi: 'गाड़ी लेकर निकलते समय दबाइए।',
    en: 'Press when you leave with the car.',
  },
  drop: {
    hi: 'गाड़ी और चाबी सौंपते समय दबाइए।',
    en: 'Press when you hand over the car and keys.',
  },
  home: { hi: 'घर पहुँचते ही दबाइए।', en: 'Press as soon as you reach home.' },
};
const ROUND_HOME_HINT = {
  hi: 'ट्रिप पूरी होने पर, गाड़ी लौटाते समय दबाइए।',
  en: 'Press when the trip is over and you return the car.',
};

/**
 * The driver's trip clock: one big button for the next step. Each press saves
 * the server's time (not the phone's), so the final bill uses the real times.
 */
export function TripClockApp() {
  const [key, setKey] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('k') ?? '';
    setKey(k);
    if (k === DEMO_KEY) {
      setState({
        kind: 'ok',
        link: {
          key: k,
          bookingId: '',
          ref: 'DB-0000',
          to: 'Bengaluru',
          kind: 'one-way',
          nonstop: false,
          driverName: 'Driver',
          closed: false,
        },
      });
      return;
    }
    if (!/^[A-Za-z0-9]{24,40}$/.test(k) || !isFirebaseConfigured()) {
      setState({ kind: 'missing' });
      return;
    }
    return watchTripLink(k, setState);
  }, []);

  if (state.kind === 'loading')
    return (
      <p className="text-fg-muted flex items-center gap-3 py-10">
        <Spinner className="size-5" /> खुल रहा है… / Opening…
      </p>
    );
  if (state.kind === 'missing')
    return <Problem hi="यह लिंक सही नहीं है। ऑफ़िस को कॉल करें।" en="This link does not work. Please call the office." />;
  if (state.kind === 'error')
    return <Problem hi="इंटरनेट चेक करें और पेज फिर खोलें।" en="Check your internet and open the page again." />;

  return <Trip link={state.link} demo={key === DEMO_KEY} onDemo={(link) => setState({ kind: 'ok', link })} />;
}

function Problem({ hi, en }: { hi: string; en: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="error">
        <p className="font-semibold">{hi}</p>
        <p>{en}</p>
      </Alert>
      <CallOffice />
    </div>
  );
}

function CallOffice() {
  return (
    <a
      href={`tel:+91${settings.contact.phone}`}
      className="border-border-strong bg-bg hover:bg-surface inline-flex h-12 items-center justify-center gap-2 rounded-xl border px-5 font-semibold"
    >
      <PhoneIcon className="size-4" /> ऑफ़िस / Office: {prettyPhone(settings.contact.phone)}
    </a>
  );
}

function Trip({ link, demo, onDemo }: { link: TripLink; demo: boolean; onDemo: (l: TripLink) => void }) {
  const step = nextStep(link);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [err, setErr] = useState('');
  const slowTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);

  async function save() {
    if (!step) return;
    setBusy(true);
    setErr('');
    setSlow(false);
    slowTimer.current = setTimeout(() => setSlow(true), 5000);
    try {
      if (demo) {
        await new Promise((r) => setTimeout(r, 600));
        onDemo({ ...link, [`${step}At`]: new Date() });
      } else {
        const loc = await currentLoc();
        await tapStep(link.key, step, loc);
      }
      setConfirming(false);
    } catch (e) {
      const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
      setErr(
        code.includes('permission-denied')
          ? 'सेव नहीं हुआ — शायद यह ट्रिप बंद हो चुकी है। ऑफ़िस को कॉल करें। / Not saved — this trip may be closed. Call the office.'
          : 'सेव नहीं हुआ। इंटरनेट चेक करके फिर दबाइए। / Not saved. Check your internet and press again.',
      );
    } finally {
      clearTimeout(slowTimer.current);
      setBusy(false);
      setSlow(false);
    }
  }

  const hint = step === 'home' && link.kind === 'round' ? ROUND_HOME_HINT : step ? HINT[step] : null;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5">
      {demo && (
        <Alert tone="info">
          <p className="font-semibold">डेमो — कुछ भी सेव नहीं होता। / Demo — nothing is saved.</p>
        </Alert>
      )}

      <Card>
        <p className="text-fg-subtle text-xs font-semibold tracking-wide uppercase">
          DriveBuddy {link.ref ? `· ${link.ref}` : ''}
        </p>
        <p className="font-display mt-1 text-xl font-bold">
          {link.kind === 'one-way' ? 'गाड़ी छोड़नी है' : 'आउटस्टेशन ट्रिप'}: {link.to}
        </p>
        <p className="text-fg-muted text-sm">
          {link.kind === 'one-way' ? 'One-way drop' : 'Round trip'} to {link.to}
          {link.driverName && link.driverName !== 'Driver' ? ` · ${link.driverName}` : ''}
          {link.nonstop ? ' · दिन-रात / day and night' : ''}
        </p>

        <ol className="mt-5 flex flex-col gap-3">
          {stepsFor(link.kind).map((s) => {
            const at = link[`${s}At` as const];
            const current = s === step;
            return (
              <li key={s} className="flex items-start gap-3">
                <span
                  className={cn(
                    'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border-2',
                    at ? 'border-success bg-success text-white' : current ? 'border-accent' : 'border-border-strong',
                  )}
                  aria-hidden
                >
                  {at && <CheckIcon className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('font-semibold', !at && !current && 'text-fg-subtle')}>
                    {stepName(s, link.kind, 'hi')} <span className="text-fg-muted font-normal">/ {stepName(s, link.kind)}</span>
                  </p>
                  <p className="text-fg-muted tabular text-sm">{at ? whenText(at) : current ? 'अब / next' : '—'}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      {step && hint ? (
        <div className="flex flex-col gap-3">
          {!confirming ? (
            <>
              <Button size="lg" fullWidth className="h-16 text-lg" onClick={() => setConfirming(true)} disabled={link.closed}>
                {stepName(step, link.kind, 'hi')} — {stepName(step, link.kind)}
              </Button>
              <p className="text-fg-muted text-center text-sm">
                {hint.hi}
                <br />
                {hint.en}
              </p>
            </>
          ) : (
            <Card tone="subtle" className="flex flex-col gap-3">
              <p className="font-semibold">
                अभी का समय सेव होगा: {timeText(now)}। पक्का?
                <br />
                <span className="text-fg-muted font-normal">This saves the time now, {timeText(now)}. Sure?</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button size="lg" onClick={save} loading={busy}>
                  हाँ / Yes
                </Button>
                <Button size="lg" variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
                  रुकें / Wait
                </Button>
              </div>
              {slow && (
                <p className="text-fg-muted text-sm">
                  नेटवर्क का इंतज़ार… पेज खुला रखें, अपने-आप सेव हो जाएगा। / Waiting for the network… keep this page open; it
                  saves by itself.
                </p>
              )}
            </Card>
          )}
          {err && <Alert tone="error">{err}</Alert>}
        </div>
      ) : (
        <Alert tone="success">
          <p className="font-semibold">धन्यवाद! ट्रिप पूरी हुई।</p>
          <p>Thank you — the trip is complete.</p>
        </Alert>
      )}

      {link.closed && step && <Alert tone="info">यह ट्रिप बंद कर दी गई है। / This trip has been closed by the office.</Alert>}

      <p className="text-fg-subtle text-xs">
        समय हमारे सर्वर से लिया जाता है, फ़ोन से नहीं। जगह भी नोट होती है, अगर आप अनुमति दें। गलती से दब जाए तो ऑफ़िस को बताइए।
        <br />
        The time comes from our server, not your phone. Where you are is noted too, if you allow it. Pressed by mistake? Tell the
        office.
      </p>
      <CallOffice />
    </div>
  );
}
