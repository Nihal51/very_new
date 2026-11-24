'use client';

import type { User } from 'firebase/auth';
import { useEffect, useState } from 'react';

import { LoginPanel } from '@/components/account/LoginPanel';
import { PhoneIcon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { chooseReturnTrain, loadProfile, saveProfile, signOutUser, watchUser, type Profile } from '@/lib/auth';
import {
  BOOKING_STATUS,
  formatDateTime,
  formatPreferred,
  packageName,
  prettyPhone,
  toBill,
  toClock,
  toDate,
  toReturnCheck,
  toReturnChoice,
  toReturnPrice,
  type Booking,
} from '@/lib/bookings';
import { seatsLink } from '@/lib/rail';
import { getFirebaseApp, isFirebaseConfigured } from '@/lib/firebase';
import { rupees } from '@/lib/settings';
import { quoteBreakdown, tripSummary } from '@/lib/trip';
import { billBreakdown, clockText } from '@/lib/tripclock';
import { normalisePhone, validateName, validatePhone } from '@/lib/validate';

type State =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'signedIn'; user: User; profile: Profile | null };

export function AccountApp() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setState({ kind: 'signedOut' });
      return;
    }
    let off: (() => void) | undefined;
    let alive = true;
    watchUser(async (user) => {
      if (!alive) return;
      if (!user) return setState({ kind: 'signedOut' });
      const profile = await loadProfile(user.uid).catch(() => null);
      if (alive) setState({ kind: 'signedIn', user, profile });
    }).then((unsub) => (off = unsub));
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  if (state.kind === 'loading')
    return (
      <div className="text-fg-muted flex items-center gap-3 py-10">
        <Spinner className="size-5" /> Loading your account…
      </div>
    );

  if (state.kind === 'signedOut')
    return (
      <div className="grid gap-10 lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-16">
        <Card>
          <h2 className="text-display-sm">Log in or sign up</h2>
          <p className="text-fg-muted mt-2 mb-6 text-[0.9375rem]">
            New here? Logging in creates your account. No new password to remember.
          </p>
          <LoginPanel />
        </Card>
        <div className="text-fg-muted flex flex-col gap-4 text-[0.9375rem] lg:pt-4">
          <h2 className="text-fg font-display text-lg font-semibold">Why log in?</h2>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>See every booking and its status: received, confirmed, driver assigned.</li>
            <li>Your name and number fill in by themselves next time.</li>
            <li>See your driver&apos;s name and number once one is assigned.</li>
          </ul>
          <p>
            You can still book without an account. <a href="/book/" className="text-accent-text font-semibold underline underline-offset-4">Book a driver</a>.
          </p>
        </div>
      </div>
    );

  if (!state.profile)
    return (
      <ProfileForm
        user={state.user}
        initial={null}
        onSaved={(profile) => setState({ ...state, profile })}
      />
    );

  return <Dashboard user={state.user} profile={state.profile} onProfile={(profile) => setState({ ...state, profile })} />;
}

/* ------------------------------------------------------------------ profile */

function ProfileForm({
  user,
  initial,
  onSaved,
  onCancel,
}: {
  user: User;
  initial: Profile | null;
  onSaved: (p: Profile) => void;
  onCancel?: () => void;
}) {
  const authPhone = user.phoneNumber ? normalisePhone(user.phoneNumber) : '';
  const [name, setName] = useState(initial?.name ?? user.displayName ?? '');
  const [phone, setPhone] = useState(initial?.phone || authPhone);
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = { name: validateName(name), phone: phone ? validatePhone(phone) : undefined };
    setErrors(next);
    if (next.name || next.phone) return;
    setBusy(true);
    setError('');
    try {
      const profile = { name: name.trim(), phone: phone ? normalisePhone(phone) : '', email: user.email ?? '' };
      await saveProfile(user.uid, profile, initial === null);
      onSaved(profile);
    } catch {
      setError('Could not save just now. Check your internet and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-lg">
      <h2 className="text-display-sm">{initial ? 'Edit your details' : 'Welcome! Just your name'}</h2>
      <p className="text-fg-muted mt-2 mb-6 text-[0.9375rem]">We use these to fill in your bookings for you.</p>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Your name" name="name" error={errors.name} required>
          {(p) => <Input {...p} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field
          label="Mobile number"
          name="phone"
          error={errors.phone}
          hint={authPhone ? 'Verified by SMS when you logged in.' : 'So our driver can call you.'}
        >
          {(p) => (
            <Input
              {...p}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              value={phone}
              readOnly={Boolean(authPhone)}
              onChange={(e) => setPhone(e.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={busy} loadingText="Saving…">
            Save
          </Button>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

/* ---------------------------------------------------------------- dashboard */

function Dashboard({ user, profile, onProfile }: { user: User; profile: Profile; onProfile: (p: Profile) => void }) {
  const [editing, setEditing] = useState(false);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let off: (() => void) | undefined;
    (async () => {
      const [app, fs] = await Promise.all([getFirebaseApp(), import('firebase/firestore')]);
      // Equality only, sorted here: needs no composite index in Firestore.
      const q = fs.query(
        fs.collection(fs.getFirestore(app), 'bookings'),
        fs.where('customerUid', '==', user.uid),
        fs.limit(200),
      );
      off = fs.onSnapshot(
        q,
        (snap) =>
          setBookings(
            snap.docs
              .map((d) => {
                const data = d.data();
                return {
                  ...(data as Omit<Booking, 'id'>),
                  id: d.id,
                  createdAt: toDate(data.createdAt),
                  clock: toClock(data.clock),
                  bill: toBill(data.bill),
                  returnCheck: toReturnCheck(data.returnCheck),
                  returnChoice: toReturnChoice(data.returnChoice),
                  returnPrice: toReturnPrice(data.returnPrice),
                };
              })
              .sort((a, b) => (b.createdAt?.getTime() ?? 9e15) - (a.createdAt?.getTime() ?? 9e15)),
          ),
        () => setLoadError(true),
      );
    })();
    return () => off?.();
  }, [user.uid]);

  if (editing)
    return (
      <ProfileForm
        user={user}
        initial={profile}
        onCancel={() => setEditing(false)}
        onSaved={(p) => {
          onProfile(p);
          setEditing(false);
        }}
      />
    );

  return (
    <div className="grid gap-8 lg:grid-cols-[20rem_1fr] lg:gap-12">
      <Card className="h-fit">
        <p className="text-fg-subtle text-sm">Logged in as</p>
        <p className="font-display mt-1 text-xl font-semibold">{profile.name}</p>
        {profile.phone && <p className="text-fg-muted mt-1 tabular">{prettyPhone(profile.phone)}</p>}
        {profile.email && <p className="text-fg-muted mt-1 text-sm break-all">{profile.email}</p>}
        <div className="mt-6 flex flex-col gap-3">
          <ButtonLink href="/book/" fullWidth>
            Book a driver
          </ButtonLink>
          <Button variant="outline" fullWidth onClick={() => setEditing(true)}>
            Edit my details
          </Button>
          <Button variant="ghost" fullWidth onClick={() => signOutUser()}>
            Log out
          </Button>
        </div>
      </Card>

      <section aria-labelledby="my-bookings">
        <h2 id="my-bookings" className="text-display-sm">
          My bookings
        </h2>
        <div className="mt-6">
          {loadError ? (
            <Alert tone="error">We could not load your bookings. Refresh the page to try again.</Alert>
          ) : bookings === null ? (
            <div className="text-fg-muted flex items-center gap-3">
              <Spinner className="size-5" /> Loading…
            </div>
          ) : bookings.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="No bookings yet"
              body="Bookings you make while logged in will show here, with their status and your driver's details."
              action={<ButtonLink href="/book/">Book a driver</ButtonLink>}
            />
          ) : (
            <ul className="flex flex-col gap-4">
              {bookings.map((b) => (
                <li key={b.id}>
                  <BookingRow b={b} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * After the drop: the trains home the robot found for the driver, with the
 * whole price with each — the customer books his ticket ("Check seats" goes
 * to the railway's seat page; nothing here checks seats), then taps "I booked
 * this train". After that: "Final price ₹2,650 · train 18452".
 */
function ReturnTrainsCard({ b }: { b: Booking }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const check = b.returnCheck!;
  const choice = b.returnChoice;
  const open = b.status === 'confirmed' || b.status === 'assigned';
  if (choice)
    return (
      <p className="border-border mt-4 border-t pt-4 text-[0.9375rem]">
        {b.returnPrice && b.returnPrice.train === choice.train ? (
          <>
            Final price <strong className="tabular">{rupees(b.returnPrice.price)}</strong> · train {choice.train}
          </>
        ) : (
          <>Train {choice.train} — the final price comes in a few minutes.</>
        )}
      </p>
    );
  return (
    <div className="border-border mt-4 border-t pt-4 text-[0.9375rem]">
      <p className="font-semibold">Your driver has dropped the car. Book his ticket home — pick a train.</p>
      {check.failed ? (
        <p className="text-fg-muted mt-1">We could not check the trains just now — our team will call you.</p>
      ) : check.options.length === 0 ? (
        <p className="text-fg-muted mt-1">No train home soon — he comes home by bus.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {check.options.map((o) => (
            <li key={`${o.train}-${o.dep?.getTime() ?? ''}`} className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-2.5">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">
                  {o.train} {o.name}
                </span>
                <span className="text-fg-muted block text-sm">
                  Leaves {o.dep ? formatDateTime(o.dep) : '?'} · arrives {b.city} {o.arr ? formatDateTime(o.arr) : '?'}
                  {o.change ? ` · change at ${o.change.station} to ${o.change.train}` : ''}
                </span>
                <span className="tabular block font-semibold">{rupees(o.price)} total</span>
              </span>
              {seatsLink(o.train) && (
                <a href={seatsLink(o.train)} target="_blank" rel="noopener noreferrer" className="text-accent-text text-sm font-semibold underline">
                  Check seats ↗
                </a>
              )}
              {open && o.dep && (
                <Button
                  size="sm"
                  loading={busy === o.train}
                  onClick={async () => {
                    setBusy(o.train);
                    setErr('');
                    try {
                      await chooseReturnTrain(b.id, o.train, o.dep!);
                    } catch {
                      setErr('Could not save. Check your internet and try again.');
                    } finally {
                      setBusy('');
                    }
                  }}
                >
                  I booked this train
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {check.bus && check.options.length > 0 && (
        <p className="text-fg-muted mt-2 text-sm">The first train leaves late — a bus is fine too; the final bill counts his real wait.</p>
      )}
      {err && (
        <Alert tone="error" className="mt-2">
          {err}
        </Alert>
      )}
    </div>
  );
}

function BookingRow({ b }: { b: Booking }) {
  const status = BOOKING_STATUS[b.status] ?? BOOKING_STATUS.new;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold">{packageName(b.package)}</p>
          <p className="text-fg-subtle text-sm">
            {b.ref ?? 'Booking'} · booked {formatDateTime(b.createdAt)}
          </p>
        </div>
        <Badge tone={status.tone}>{status.customerLabel}</Badge>
      </div>
      <dl className="text-fg-muted mt-4 grid gap-x-6 gap-y-2 text-[0.9375rem] sm:grid-cols-2">
        <div>
          <dt className="text-fg-subtle text-xs">Pickup</dt>
          <dd>
            {b.pickup}, {b.city}
          </dd>
        </div>
        <div>
          <dt className="text-fg-subtle text-xs">When</dt>
          <dd>{formatPreferred(b.preferredTime)}</dd>
        </div>
        {b.trip && (
          <div className="sm:col-span-2">
            <dt className="text-fg-subtle text-xs">Trip</dt>
            <dd>{tripSummary(b.trip, b.city)}</dd>
          </div>
        )}
        {b.quote && (
          <div className="sm:col-span-2">
            <dt className="text-fg-subtle text-xs">Agreed price</dt>
            <dd>
              <strong className="text-fg tabular">{rupees(b.quote.amount)}</strong>{' '}
              <span className="text-fg-subtle text-sm">({quoteBreakdown(b.quote)})</span>
            </dd>
          </div>
        )}
        {b.clock && b.trip && (
          <div className="sm:col-span-2">
            <dt className="text-fg-subtle text-xs">Trip times</dt>
            <dd>{clockText(b.clock, b.trip.kind)}</dd>
          </div>
        )}
        {b.bill && (
          <div className="sm:col-span-2">
            <dt className="text-fg-subtle text-xs">Final bill (from the real times)</dt>
            <dd>
              <strong className="text-fg tabular">{rupees(b.bill.amount)}</strong>{' '}
              <span className="text-fg-subtle text-sm">({billBreakdown(b.bill)})</span>
            </dd>
          </div>
        )}
      </dl>
      {b.returnCheck && <ReturnTrainsCard b={b} />}
      {b.assignedDriver && b.status === 'assigned' && (
        <div className="border-border mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-[0.9375rem]">
            Your driver: <strong>{b.assignedDriver.name}</strong>
          </p>
          <a
            href={`tel:+91${b.assignedDriver.phone}`}
            className="text-accent-text inline-flex items-center gap-2 font-semibold tabular"
          >
            <PhoneIcon className="size-4" />
            {prettyPhone(b.assignedDriver.phone)}
          </a>
        </div>
      )}
    </Card>
  );
}
