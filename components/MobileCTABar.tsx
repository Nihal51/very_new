import { PhoneIcon, WhatsappIcon } from '@/components/icons';
import { site, telHref, waHref } from '@/lib/site';

/**
 * Mobile-only sticky action bar.
 *
 * This business converts over the phone, so on a phone the two things that
 * matter are never more than a thumb away. Hidden from `lg` up, where the
 * header already carries the call button.
 */
export function MobileCTABar() {
  return (
    <div
      className={[
        'border-border bg-bg/95 fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur-md lg:hidden',
        'pb-[env(safe-area-inset-bottom)]',
      ].join(' ')}
    >
      <div className="flex gap-2 px-3 py-2.5">
        <a
          href={telHref}
          className="bg-accent text-ink hover:bg-accent-hover flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-[0.9375rem] font-semibold transition-colors duration-150"
        >
          <PhoneIcon className="size-[1.125rem]" />
          Call now
        </a>
        <a
          href={waHref(`Hi ${site.name}, I need a driver.`)}
          target="_blank"
          rel="noopener noreferrer"
          className="border-border-strong text-fg hover:bg-surface flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border text-[0.9375rem] font-semibold transition-colors duration-150"
        >
          <WhatsappIcon className="size-[1.125rem]" />
          WhatsApp
        </a>
      </div>
    </div>
  );
}
