'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { TripEstimate } from '@/components/TripEstimate';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { cities } from '@/lib/content';
import { ELSEWHERE, destinationGroups, tripFor } from '@/lib/trip';

/**
 * "What will my drop cost?" on the One-Way Drop page: pickup city, destination
 * and days → the same estimate the booking form shows, and a button that
 * opens the booking form with all three already filled in.
 */
export function OneWayPriceChecker({ className }: { className?: string }) {
  const router = useRouter();
  const [city, setCity] = useState('Raipur');
  const [dest, setDest] = useState('nagpur');
  const [days, setDays] = useState('');

  const trip = useMemo(() => tripFor('one-way-drop', city, dest, Number(days) || 0), [city, dest, days]);
  const query = new URLSearchParams({ pkg: 'one-way-drop', city, to: dest });
  if (days && Number(days) > trip.minDays) query.set('days', String(Number(days)));

  return (
    <Card className={className}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="From" name="ow-city">
          {(p) => (
            <Select {...p} value={city} onChange={(e) => setCity(e.target.value)}>
              {cities.map((c) => (
                <option key={c.slug} value={c.name}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Drop in" name="ow-dest">
          {(p) => (
            <Select {...p} value={dest} onChange={(e) => setDest(e.target.value)}>
              {destinationGroups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.items.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value={ELSEWHERE}>Somewhere else…</option>
            </Select>
          )}
        </Field>
        <Field
          label="Days"
          name="ow-days"
          optionalLabel
          hint={trip.km ? `At least ${trip.minDays} for this distance.` : 'How many days you need the driver.'}
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              inputMode="numeric"
              min={trip.minDays}
              max={60}
              step={1}
              placeholder={String(trip.minDays)}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          )}
        </Field>
      </div>

      <TripEstimate
        view={trip}
        city={city}
        elsewhere={dest === ELSEWHERE}
        onUseLocal={() => router.push(`/book/?pkg=local-full-day&city=${encodeURIComponent(city)}#booking-form`)}
        className="mt-5"
      />

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <ButtonLink href={`/book/?${query.toString()}#booking-form`} size="lg" className="w-full sm:w-auto">
          Book this drop
        </ButtonLink>
        <p className="text-fg-subtle text-sm">No payment now. We call you to confirm the price first.</p>
      </div>
    </Card>
  );
}
