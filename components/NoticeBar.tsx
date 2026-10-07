import { settings } from '@/lib/settings';

/**
 * The one-line notice across the top of every page — a festival message, a
 * holiday closure, a new service. Switched on and written in site-settings.ts
 * (`notice.show` / `notice.text`); renders nothing while it is off.
 *
 * Amber with near-black text, the site's accessible accent pairing (11.4:1).
 * The text goes through the same claims audit as every other page, so a notice
 * cannot announce an invented rating or customer count either.
 */
export function NoticeBar() {
  const { show, text } = settings.notice;
  if (!show || !text.trim()) return null;

  return (
    <aside aria-label="Notice" className="bg-accent text-ink">
      <p className="container-page py-2.5 text-center text-sm font-semibold">{text}</p>
    </aside>
  );
}
