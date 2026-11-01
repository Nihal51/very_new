'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker } from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { MapPinIcon } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { CITY_CENTRES, accuracyText, mapsLink, toPickupGeo, type PickupGeo } from '@/lib/geo';
import { cn } from '@/lib/cn';

type Status = 'idle' | 'locating' | 'denied' | 'unavailable';

/**
 * The exact pickup spot, under the typed address — optional. "Use my current
 * location" asks the browser for GPS; the map (OpenStreetMap, no key, no
 * bill) opens on that spot or on the city, and the customer drags the pin to
 * the exact gate. The map's code loads only when it is opened, so the booking
 * page stays light.
 */
export function PickupLocation({
  city,
  value,
  onChange,
  className,
}: {
  city: string;
  value: PickupGeo | null;
  onChange: (g: PickupGeo | null) => void;
  className?: string;
}) {
  const [status, setStatus] = useState<Status>('idle');
  const [mapOpen, setMapOpen] = useState(false);

  function locate() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable');
      setMapOpen(true);
      return;
    }
    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const g = toPickupGeo(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        setStatus(g ? 'idle' : 'unavailable');
        if (g) onChange(g);
        setMapOpen(true);
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
        setMapOpen(true);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={locate} loading={status === 'locating'}>
          <MapPinIcon className="size-4" aria-hidden="true" /> Use my current location
        </Button>
        {!mapOpen && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setMapOpen(true)}>
            Pin it on the map
          </Button>
        )}
        <span className="text-fg-subtle text-xs">Optional — helps the driver find the exact gate.</span>
      </div>

      {status === 'denied' && (
        <p className="text-fg-muted text-sm">
          Location is blocked in your browser. Drag the pin to your pickup spot on the map, or just type the address.
        </p>
      )}
      {status === 'unavailable' && (
        <p className="text-fg-muted text-sm">
          We could not get your location. Drag the pin to your pickup spot on the map, or just type the address.
        </p>
      )}

      {mapOpen && <PinMap city={city} value={value} onChange={onChange} />}

      {value && (
        <p className="text-sm" aria-live="polite">
          <span className="text-success font-semibold">Location pinned</span>{' '}
          <span className="text-fg-subtle">({accuracyText(value)})</span> ·{' '}
          <a href={mapsLink(value)} target="_blank" rel="noopener noreferrer" className="text-accent-text underline underline-offset-2">
            check in Google Maps
          </a>{' '}
          ·{' '}
          <button type="button" className="text-fg-muted underline underline-offset-2" onClick={() => onChange(null)}>
            remove
          </button>
        </p>
      )}
    </div>
  );
}

/** The map with one draggable pin. Tapping the map moves the pin there too. */
function PinMap({ city, value, onChange }: { city: string; value: PickupGeo | null; onChange: (g: PickupGeo | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  // Create the map once.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const L = (await import('leaflet')).default;
      if (!alive || !box.current || map.current) return;
      const start = value ?? CITY_CENTRES[city] ?? CITY_CENTRES.Raipur!;
      const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView([start.lat, start.lng], value ? 17 : 13);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
      // A CSS pin: no marker images to bundle.
      const icon = L.divIcon({
        className: '',
        html: '<div style="width:28px;height:28px;margin:-28px 0 0 -14px;border-radius:50% 50% 50% 0;background:#F59E0B;border:3px solid #141210;transform:rotate(-45deg)"></div>',
        iconSize: [0, 0],
      });
      const pin = L.marker([start.lat, start.lng], { draggable: true, icon, keyboard: true, title: 'Pickup spot' }).addTo(m);
      // A hand-placed pin has no GPS accuracy.
      const place = (lat: number, lng: number) => {
        const g = toPickupGeo(lat, lng);
        if (g) changeRef.current(g);
      };
      pin.on('dragend', () => {
        const p = pin.getLatLng();
        place(p.lat, p.lng);
      });
      m.on('click', (e) => {
        pin.setLatLng(e.latlng);
        place(e.latlng.lat, e.latlng.lng);
      });
      map.current = m;
      marker.current = pin;
    })();
    return () => {
      alive = false;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
    // Created once; later spots move the pin (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new GPS fix (or "remove") moves the pin.
  useEffect(() => {
    if (!map.current || !marker.current || !value) return;
    marker.current.setLatLng([value.lat, value.lng]);
    map.current.setView([value.lat, value.lng], Math.max(map.current.getZoom(), 17));
  }, [value]);

  return (
    <div>
      <div ref={box} className="border-border h-64 w-full overflow-hidden rounded-lg border" aria-label="Map: drag the pin to your pickup spot" />
      <p className="text-fg-subtle mt-1 text-xs">Drag the pin, or tap the map, to mark the exact pickup spot.</p>
    </div>
  );
}
