'use client';

import { useEffect, useMemo, useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Input } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Spinner';
import { formatDateTime, packageName, prettyPhone, toDate, type Customer } from '@/lib/bookings';
import { getFirebaseApp } from '@/lib/firebase';

/**
 * One row per phone number, built by the server from every booking — so a
 * customer who booked five times as a guest is still one person here.
 */
export function CustomersTab() {
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let off: (() => void) | undefined;
    (async () => {
      const [app, fs] = await Promise.all([getFirebaseApp(), import('firebase/firestore')]);
      const q = fs.query(fs.collection(fs.getFirestore(app), 'customers'), fs.orderBy('lastBookingAt', 'desc'), fs.limit(500));
      off = fs.onSnapshot(
        q,
        (snap) =>
          setRows(
            snap.docs.map((d) => {
              const data = d.data();
              return {
                ...(data as Omit<Customer, 'id'>),
                id: d.id,
                firstBookingAt: toDate(data.firstBookingAt),
                lastBookingAt: toDate(data.lastBookingAt),
              };
            }),
          ),
        () => setError(true),
      );
    })();
    return () => off?.();
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((c) => !q || [c.name, c.phone, c.city].some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [rows, search]);

  if (error) return <Alert tone="error">Could not load customers. Refresh the page to try again.</Alert>;
  if (!rows)
    return (
      <div className="text-fg-muted flex items-center gap-3">
        <Spinner className="size-5" /> Loading customers…
      </div>
    );

  const repeat = rows.filter((c) => c.bookingsCount > 1).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-fg-muted text-sm">
          {rows.length} customers · {repeat} booked more than once
        </p>
        <Input
          type="search"
          placeholder="Search name, phone, city…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
          aria-label="Search customers"
        />
      </div>
      {rows.length === 0 ? (
        <p className="text-fg-muted py-10 text-center">
          Customers appear here automatically after their first booking (once the backend is deployed).
        </p>
      ) : (
        <div className="border-border overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-bg-subtle text-fg-subtle text-xs uppercase">
              <tr>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">City</th>
                <th className="px-4 py-3 text-right">Bookings</th>
                <th className="px-4 py-3">Last booking</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id} className="border-border border-t">
                  <td className="px-4 py-3 font-semibold">{c.name}</td>
                  <td className="px-4 py-3 tabular">
                    <a href={`tel:+91${c.phone}`} className="text-accent-text underline-offset-4 hover:underline">
                      {prettyPhone(c.phone)}
                    </a>
                  </td>
                  <td className="px-4 py-3">{c.city}</td>
                  <td className="px-4 py-3 text-right tabular">{c.bookingsCount}</td>
                  <td className="text-fg-muted px-4 py-3">
                    {c.lastBookingRef} · {c.lastPackage ? packageName(c.lastPackage) : ''}
                    <br />
                    <span className="text-fg-subtle text-xs">{formatDateTime(c.lastBookingAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
