/**
 * Fails the build if a price or a phone number is typed into the site's code
 * instead of coming from site-settings.ts.
 *
 * Run with:  npm run lint   (the deploy workflow runs it before every build)
 *
 * site-settings.ts is promised to be the ONE place to change a price. That
 * promise only holds while nobody types "₹500" into a sentence somewhere else —
 * the day they do, editing the settings file updates every page except that one,
 * and the site quietly quotes two prices. So this reads every string and every
 * piece of JSX text in app/, components/ and lib/ (comments are skipped — they
 * are not shown to anyone) and refuses a ₹ figure or a 10-digit mobile number.
 *
 * To show a price, use `priceText` from lib/settings.ts; for the phone number,
 * `site.phone` from lib/site.ts.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIRS = ['app', 'components', 'lib'];

/* The two files that are allowed to talk about prices: the formatter and the
   settings checker (its error messages quote example values). */
const ALLOWED = new Set(['lib/settings.ts', 'lib/settings-schema.ts']);

const RULES = [
  { re: /₹\s?\d/, what: 'a ₹ price', fix: 'use priceText from lib/settings.ts' },
  { re: /(?<!\d)[6-9]\d{9}(?!\d)/, what: 'a phone number', fix: 'use site.phone / site.phoneAlt from lib/site.ts' },
];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

const problems = [];

for (const file of DIRS.flatMap((d) => walk(path.join(ROOT, d)))) {
  const rel = path.relative(ROOT, file).replaceAll('\\', '/');
  if (ALLOWED.has(rel)) continue;

  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const check = (node, text) => {
    for (const rule of RULES) {
      const hit = rule.re.exec(text);
      if (!hit) continue;
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      const at = Math.max(0, hit.index - 20);
      problems.push(`${rel}:${line + 1}  ${rule.what} "…${text.slice(at, hit.index + 20).trim()}…" — ${rule.fix}`);
    }
  };

  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) {
      check(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      check(node, node.head.text);
      for (const span of node.templateSpans) check(span, span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (problems.length) {
  console.error(
    `\nPrices and phone numbers belong in site-settings.ts. Found ${problems.length} typed into the code:\n\n` +
      problems.map((p) => `  ${p}`).join('\n') +
      '\n',
  );
  process.exit(1);
}
console.log('check-prices — ok: no ₹ figure or phone number typed outside site-settings.ts');
