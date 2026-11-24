'use client';

import { useEffect, useId, useMemo, useState } from 'react';

import type { FieldControlProps } from '@/components/ui/Field';
import { Input } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { destinations, findDestination, pickupCities, roadKm, type PickupCity } from '@/lib/outstation';
import { PLACES_PATH, parsePlaces, placeIndex, placeKm, placeLabel, searchPlaces, type Place, type PlaceEntry } from '@/lib/places';
import { settings } from '@/lib/settings';
import { asset } from '@/lib/site';
import { ELSEWHERE, PLACE } from '@/lib/trip';

/** What the box holds: one of ours (its id), a place from the list (PLACE + the place), a typed place (ELSEWHERE + the text), or ''. */
export type PlaceValue = { dest: string; place: Place | null; other: string };

/** Our destinations alone — searchable at once, before the list of all India arrives. */
const CURATED = placeIndex([], destinations);

let loading: Promise<PlaceEntry[]> | null = null;

/**
 * The list of all India (public/data/india-places.json, ~190 KB), fetched
 * once — the first time a place box is used — and kept in memory.
 */
export function loadPlaceIndex(): Promise<PlaceEntry[]> {
  loading ??= fetch(asset(PLACES_PATH))
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`places: ${r.status}`))))
    .then((json) => placeIndex(parsePlaces(json), destinations))
    .catch((err) => {
      loading = null; // try again next time
      throw err;
    });
  return loading;
}

/** A place picked from a link (/book/?to=place&place=Name, State): looked up in the list. */
export async function findPlaceByLabel(label: string): Promise<Place | undefined> {
  const index = await loadPlaceIndex().catch(() => [] as PlaceEntry[]);
  return index.find((e) => e.place && placeLabel(e.place) === label)?.place;
}

const isPickup = (city: string): city is PickupCity => (pickupCities as readonly string[]).includes(city);

/** "Prayagraj, Uttar Pradesh · about 590 km" — km from the pickup city (ours: measured; others: from the map). */
function optionText(e: PlaceEntry, city: string): { title: string; km: string } {
  const title = e.state ? `${e.name}, ${e.state}` : e.name;
  if (!isPickup(city)) return { title, km: '' };
  const km = e.dest ? roadKm(city, e.dest) : e.place ? placeKm(findDestination(city.toLowerCase())!, e.place, settings.outstation.roadFactor) : 0;
  return { title, km: km > 0 ? `about ${new Intl.NumberFormat('en-IN').format(km)} km` : '' };
}

/** The text the box shows for a value. */
function labelOf(v: PlaceValue): string {
  if (v.dest === PLACE && v.place) return placeLabel(v.place);
  if (v.dest === ELSEWHERE) return v.other;
  const d = v.dest ? CURATED.find((e) => e.dest?.id === v.dest) : undefined;
  return d ? (d.state ? `${d.name}, ${d.state}` : d.name) : '';
}

type Option = { key: string; entry?: PlaceEntry; other?: string };

/**
 * "Drop the car in" / "Where to?": a search box over every place in India
 * (an ARIA 1.2 combobox with a listbox). Typing 2 letters or more lists up to
 * 20 places — names, old names and states, accents and case ignored; ours
 * first among equals — with the km from the pickup city. The last option
 * keeps what was typed ("Somewhere else"): the team prices it on the call.
 * Arrow keys move, Enter picks, Escape closes; taps work the same on phones.
 */
export function PlacePicker({
  field,
  city,
  value,
  onChange,
  onBlur,
  placeholder = 'Type a city, town or state',
}: {
  field: FieldControlProps;
  city: string;
  value: PlaceValue;
  onChange: (v: PlaceValue) => void;
  onBlur?: () => void;
  placeholder?: string;
}) {
  const uid = useId();
  const listId = `${field.id}-list`;
  const optId = (i: number) => `${field.id}-opt-${i}`;

  const [index, setIndex] = useState<PlaceEntry[]>(CURATED);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [text, setText] = useState(() => labelOf(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);

  // A value set from outside (a link) shows in the box; what is being typed (or was typed and not picked) stays.
  const shown = labelOf(value);
  const [lastShown, setLastShown] = useState(shown);
  if (shown !== lastShown) {
    setLastShown(shown);
    if (!focused) setText(shown);
  }

  const load = () => {
    if (status === 'loading' || status === 'ready') return;
    setStatus('loading');
    loadPlaceIndex()
      .then((all) => {
        setIndex(all);
        setStatus('ready');
      })
      .catch(() => setStatus('failed'));
  };

  // Typing: the matches; an empty box (or the chosen place itself): our destinations to browse.
  const query = text.trim() === shown ? '' : text.trim();
  const options: Option[] = useMemo(() => {
    const found = query.length >= 2 ? searchPlaces(index, query, 20) : index.filter((e) => e.dest);
    const list: Option[] = found.map((e) => ({ key: e.dest ? `d:${e.dest.id}` : `p:${e.name}:${e.state}:${e.lat}`, entry: e }));
    if (query.length >= 2) list.push({ key: 'other', other: query.slice(0, 60) });
    return list;
  }, [index, query]);

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${field.id}-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, field.id]);

  const pick = (o: Option) => {
    const next: PlaceValue = o.entry?.dest
      ? { dest: o.entry.dest.id, place: null, other: '' }
      : o.entry?.place
        ? { dest: PLACE, place: o.entry.place, other: '' }
        : { dest: ELSEWHERE, place: null, other: o.other ?? '' };
    onChange(next);
    setText(labelOf(next));
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      load();
      if (!open) {
        setOpen(true);
        setActive(e.key === 'ArrowDown' ? 0 : options.length - 1);
        return;
      }
      const n = options.length;
      if (!n) return;
      setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n));
    } else if (e.key === 'Enter') {
      // The highlighted option, or — while searching — the best match; never a guess on an untouched box.
      const chosen = open ? (active >= 0 ? options[active] : query.length >= 2 ? options[0] : undefined) : undefined;
      if (chosen) {
        e.preventDefault(); // pick, do not send the form
        pick(chosen);
      } else if (open) setOpen(false);
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    }
  };

  const count = options.filter((o) => o.entry).length;
  const live =
    !open
      ? ''
      : query.length < 2
        ? 'Our destinations. Type to search all of India.'
        : count
          ? `${count} place${count === 1 ? '' : 's'} found.`
          : status === 'loading'
            ? 'Searching all of India…'
            : 'No place found. You can keep what you typed.';

  return (
    <div className="relative">
      <Input
        {...field}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="words"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={60}
        placeholder={placeholder}
        value={text}
        onFocus={(e) => {
          setFocused(true);
          load();
          setOpen(true);
          if (shown) e.currentTarget.select();
        }}
        onPointerDown={load}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
          load();
          // Typing changes the place: nothing is chosen until one is picked.
          if (value.dest) onChange({ dest: '', place: null, other: '' });
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setFocused(false);
          setOpen(false);
          setActive(-1);
          onBlur?.();
        }}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Places"
        hidden={!open || options.length === 0}
        className="border-border bg-bg absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border p-1 shadow-lg"
      >
        {options.map((o, i) => {
          const t = o.entry ? optionText(o.entry, city) : undefined;
          return (
            <li
              key={o.key}
              id={optId(i)}
              role="option"
              aria-selected={i === active}
              // Keep the focus in the box, so a tap picks before the box closes.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              onMouseMove={() => active !== i && setActive(i)}
              className={cn(
                'flex min-h-11 cursor-pointer flex-col justify-center rounded-lg px-3 py-1.5 text-sm',
                i === active ? 'bg-accent-subtle' : 'hover:bg-surface',
              )}
            >
              {t ? (
                <>
                  <span className="font-medium">
                    {t.title}
                    {o.entry?.dest && <span className="text-fg-subtle ml-1.5 text-xs font-normal">our route</span>}
                  </span>
                  {t.km && <span className="text-fg-subtle text-xs">{t.km}</span>}
                </>
              ) : (
                <>
                  <span className="font-medium">Somewhere else: “{o.other}”</span>
                  <span className="text-fg-subtle text-xs">We work out the distance and the price on the call</span>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p className="sr-only" aria-live="polite" id={`${uid}-live`}>
        {live}
      </p>
      <p className="text-fg-subtle mt-1 text-[0.6875rem]">
        Places: GeoNames (CC BY 4.0) · Stations: datameet (CC0)
        {status === 'failed' ? ' · the list of all India could not load — our destinations and “somewhere else” still work' : ''}
      </p>
    </div>
  );
}
