/**
 * Emits a JSON-LD <script>. Static export inlines this into the HTML, so crawlers
 * see the structured data without executing anything.
 */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // Content is authored in lib/schema.ts, not user input. Escaping `<`
      // keeps a stray sequence from closing the script tag early.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  );
}
