'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  compare,
  ContactButtons,
  DownloadIcon,
  Grid,
  SearchBox,
  SortTh,
  Th,
  theadCls,
  ToolButton,
  type Sort,
} from '@/components/admin/kit';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Spinner';
import { formatDateTime, packageName, prettyPhone, toDate, type Customer } from '@/lib/bookings';
import { downloadCsv, exportName, sheetPhone } from '@/lib/export';
import { getFirebaseApp } from '@/lib/firebase';

type SortKey = 'name' | 'city' | 'count' | 'last' | 'first';
const sortValue = (c: Customer, k: SortKey) =>
  k === 'name'
    ? c.name?.toLowerCase()
    : k === 'city'
      ? c.city
      : k === 'count'
        ? c.bookingsCount
        : k === 'first'
          ? c.firstBookingAt?.getTime()
          : c.lastBookingAt?.getTime();

/**
 * One row per phone number, built by the alerts robot from every booking — so
 * a customer who booked five times as a guest is still one person here.
 */
export function CustomersTab() {
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [repeatOnly, setRepeatOnly] = useState(false);
  const [sort, setSort] = useState<Sort<SortKey>>({ key: 'last', dir: 'desc' });

  useEffect(() => {
    let off: (() => void) | undefined;
    (async () => {
      const [app, fs] = await Promise.all([getFirebaseApp(), import('firebase/firestore')]);
      const q = fs.query(fs.collection(fs.getFirestore(app), 'customers'), fs.orderBy('lastBookingAt', 'desc'), fs.limit(1000));
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
    return (rows ?? [])
      .filter(
        (c) =>
          (!repeatOnly || c.bookingsCount > 1) &&
          (!q || [c.name, c.phone, c.city].some((v) => String(v ?? '').toLowerCase().includes(q))),
      )
      .sort((a, b) => compare(sortValue(a, sort.key), sortValue(b, sort.key), sort.dir));
  }, [rows, search, repeatOnly, sort]);

  if (error) return <Alert tone="error">Could not load customers. Refresh the page to try again.</Alert>;
  if (!rows)
    return (
      <div className="text-fg-muted flex items-center gap-3 py-10">
        <Spinner className="size-5" /> Loading customers…
      </div>
    );

  const repeat = rows.filter((c) => c.bookingsCount > 1).length;

  function exportRows() {
    downloadCsv(exportName('customers'), [
      ['Customer', 'Phone', 'City', 'Bookings', 'First booking', 'Last booking', 'Last ref', 'Last package'],
      ...visible.map((c) => [
        c.name,
        sheetPhone(c.phone),
        c.city,
        c.bookingsCount,
        formatDateTime(c.firstBookingAt),
        formatDateTime(c.lastBookingAt),
        c.lastBookingRef ?? '',
        c.lastPackage ? packageName(c.lastPackage) : '',
      ]),
    ]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, phone, city…" />
        <label className="text-fg-muted inline-flex h-9 items-center gap-2 px-1 text-sm font-medium">
          <input type="checkbox" checked={repeatOnly} onChange={(e) => setRepeatOnly(e.target.checked)} className="accent-accent size-4" />
          Repeat customers only ({repeat})
        </label>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-fg-subtle text-sm tabular">
            {visible.length} of {rows.length}
          </span>
          <ToolButton onClick={exportRows} title="Download these rows as a file for Excel or Google Sheets">
            <DownloadIcon className="size-4" /> Excel
          </ToolButton>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="border-border text-fg-muted rounded-xl border border-dashed py-16 text-center">
          Customers appear here automatically after their first booking (once the alerts robot is running).
        </div>
      ) : (
        <Grid minWidth="52rem">
          <thead className={theadCls}>
            <tr>
              <SortTh k="name" sort={sort} onSort={setSort}>Customer</SortTh>
              <Th>Phone</Th>
              <SortTh k="city" sort={sort} onSort={setSort}>City</SortTh>
              <SortTh k="count" sort={sort} onSort={setSort} className="text-right">Bookings</SortTh>
              <SortTh k="last" sort={sort} onSort={setSort}>Last booking</SortTh>
              <SortTh k="first" sort={sort} onSort={setSort}>Customer since</SortTh>
              <Th className="text-right">Contact</Th>
            </tr>
          </thead>
          <tbody className="[&_td]:border-border [&_td]:border-b [&_tr:last-child_td]:border-b-0">
            {visible.map((c) => (
              <tr key={c.id} className="hover:bg-surface">
                <td className="px-3 py-2.5 font-medium">{c.name}</td>
                <td className="px-3 py-2.5 whitespace-nowrap tabular">{prettyPhone(c.phone)}</td>
                <td className="px-3 py-2.5">{c.city}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular">{c.bookingsCount}</td>
                <td className="px-3 py-2.5">
                  <span className="tabular">{c.lastBookingRef}</span>
                  {c.lastPackage && <span className="text-fg-muted"> · {packageName(c.lastPackage)}</span>}
                  <div className="text-fg-subtle text-xs">{formatDateTime(c.lastBookingAt)}</div>
                </td>
                <td className="text-fg-muted px-3 py-2.5 whitespace-nowrap">{formatDateTime(c.firstBookingAt)}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1.5">
                    <ContactButtons phone={c.phone} size="sm" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Grid>
      )}
    </div>
  );
}
