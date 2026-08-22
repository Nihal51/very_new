import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/icons';
import { pillars } from '@/lib/content';

/** The four-stage verification process — the site's core trust argument. */
export function Pillars() {
  return (
    <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {pillars.map((pillar) => (
        <li key={pillar.step} className="reveal">
          <Card className="h-full">
            <div className="flex items-center justify-between">
              <span className="bg-accent-subtle text-accent-text flex size-11 items-center justify-center rounded-xl">
                <Icon name={pillar.icon} className="size-5.5" />
              </span>
              <span className="tabular text-border-strong font-display text-2xl font-bold">
                {pillar.step}
              </span>
            </div>
            <h3 className="font-display mt-5 text-lg font-semibold">{pillar.title}</h3>
            <p className="text-fg-muted mt-2 text-[0.9375rem]">{pillar.body}</p>
          </Card>
        </li>
      ))}
    </ol>
  );
}
