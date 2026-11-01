/**
 * The customer's exact pickup spot: optional, next to the typed address.
 * Set with "Use my current location" (GPS, with its accuracy) or by dragging
 * the pin on the map (no accuracy). Saved on the booking as `pickupGeo`
 * (firestore.rules isGeo), and sent to the team as a Google Maps link by the
 * alerts robot (apps-script/Code.js). The app writes the same shape.
 *
 * No @/ imports, so Node tests can load it.
 */

export type PickupGeo = {
  lat: number;
  lng: number;
  /** Metres, from the phone's GPS; left out when the pin was placed by hand. */
  acc?: number;
};

/** Roughly India: the same bounds firestore.rules checks. A spot outside is a mistake. */
export const INDIA = { south: 6, north: 37, west: 68, east: 98 } as const;

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** A checked, rounded spot (6 decimals ≈ 10 cm), or null if it is not a place in India. */
export function toPickupGeo(lat: unknown, lng: unknown, acc?: unknown): PickupGeo | null {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < INDIA.south || la > INDIA.north || ln < INDIA.west || ln > INDIA.east) return null;
  const a = Number(acc);
  const accuracy = acc !== undefined && acc !== null && Number.isFinite(a) && a >= 0 ? Math.min(Math.round(a), 100_000) : undefined;
  return { lat: round6(la), lng: round6(ln), ...(accuracy !== undefined && { acc: accuracy }) };
}

/** A stored value → PickupGeo, or null (old bookings have none). */
export function readPickupGeo(v: unknown): PickupGeo | null {
  if (!v || typeof v !== 'object') return null;
  const g = v as Record<string, unknown>;
  return toPickupGeo(g.lat, g.lng, g.acc);
}

/** Opens the spot in Google Maps (app or browser), ready for directions. */
export const mapsLink = (g: Pick<PickupGeo, 'lat' | 'lng'>) => `https://www.google.com/maps?q=${g.lat},${g.lng}`;

/** "±15 m" for a GPS fix, "pinned on the map" for a hand-placed pin. */
export const accuracyText = (g: PickupGeo) => (g.acc !== undefined ? `±${g.acc} m` : 'pinned on the map');

/** Where the map opens before the customer has a spot: the pickup city's centre. */
export const CITY_CENTRES: Record<string, { lat: number; lng: number }> = {
  Raipur: { lat: 21.2514, lng: 81.6296 },
  Bhilai: { lat: 21.1938, lng: 81.3509 },
  Durg: { lat: 21.1904, lng: 81.2849 },
  Bilaspur: { lat: 22.0797, lng: 82.1391 },
};
