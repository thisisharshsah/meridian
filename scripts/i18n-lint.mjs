/**
 * Words a person reads must come from the catalogue, not from the JSX.
 *
 * The rule is easy to keep while you remember it and impossible to keep by
 * memory alone -- one `title="Duplicate"` slips in and the Polish build has a
 * lone English word in it, discovered by a Polish speaker rather than by us.
 * So it is checked. The scan is deliberately shallow: it reads the shapes that
 * actually reach a screen, and anything it cannot judge it leaves alone.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../apps/web/src", import.meta.url).pathname;

/** Attributes whose value is read aloud or read on screen. */
const SPOKEN = ["placeholder", "aria-label", "title", "description", "label", "alt"];

/**
 * Property and attribute names whose value is machinery, not words: a class
 * list, a route, an icon name, a query key. Everything else holding a
 * sentence is a string someone reads.
 */
const TECHNICAL = new Set([
  "className", "class", "href", "src", "key", "id", "name", "icon", "type", "role", "path",
  "queryKey", "value", "tone", "variant", "size", "method", "target", "rel", "accept",
  "autoComplete", "inputMode", "charSet", "as", "mode", "entity", "module", "field", "op",
  "status", "kind", "color", "sort", "dir", "locale", "format", "server", "tool", "collection",
  "displayName",
]);

const PATTERNS = [
  // A JSX text node that is a sentence rather than a value or a symbol.
  { re: />\s*([A-Z][a-z]+(?:[ ,'’-][A-Za-z]+)*[.?!]?)\s*</g, what: "text" },
  { re: new RegExp(`\\b(?:${SPOKEN.join("|")})="([A-Z][^"]{2,})"`, "g"), what: "attribute" },
  { re: /toast\.(?:error|success|message|warning)\(\s*"([^"]+)"/g, what: "toast" },
];

/**
 * Strings that are not prose: a brand, a header name, a code sample. Each one
 * is a deliberate exception, so the list is short and stays that way.
 */
const ALLOWED = new Set(["Aurovie", "Meridian"]);

/**
 * Prose hiding in an expression rather than in a text node.
 *
 * `{starting ? "You will own this" : "Sign up first"}` and
 * `{ label: "I was invited" }` both reach the screen and neither looks like a
 * JSX text node, which is how the sign-up page kept two English sentences
 * through a sweep that claimed to have caught everything.
 */
function prose(text) {
  if (!/[A-Za-z]{2}/.test(text)) return false;
  if (/^https?:|^[/#.]/.test(text)) return false;
  // A Tailwind class list. Every token is machinery -- hyphens, variants,
  // arbitrary values -- and not one of them starts with a capital letter.
  const tokens = text.trim().split(/\s+/);
  const classy = (k) => /^[a-z0-9!:[\]/@.&_()-]+$/.test(k);
  if (tokens.every(classy) && tokens.some((k) => /[-:[]/.test(k))) return false;
  if (/^[A-Z0-9_]+$/.test(text)) return false;
  // A CSS value, not a sentence: a length, a colour, a function call.
  if (/^\d|\d(px|rem|em|%)|^[a-z-]+\(|^\(/.test(text)) return false;
  return /\s/.test(text) || /^[A-Z][a-z]+(['’\u2019][a-z]+)?$/.test(text);
}

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".tsx")) files.push(p);
  }
})(ROOT);

const found = [];
for (const file of files.sort()) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  // Every quoted string, judged by what precedes it.
  for (const m of src.matchAll(
    /(\w[\w-]*)?\s*[:=]\s*\{?\s*"([^"\\\n]{3,})"|\{\s*[^{}\n]{0,60}?\?\s*"([^"\\\n]{3,})"|:\s*"([^"\\\n]{3,})"\s*\}/g,
  )) {
    const prop = m[1];
    const text = m[2] ?? m[3] ?? m[4];
    if (!text || !prose(text)) continue;
    if (prop && TECHNICAL.has(prop)) continue;
    if (ALLOWED.has(text)) continue;
    // `e.key === "Enter"` is a comparison against a browser constant, not a
    // word anybody reads.
    const quote = src.indexOf(`"${text}"`, m.index);
    if (quote > 0 && /[=!]==?\s*$/.test(src.slice(Math.max(0, quote - 8), quote))) continue;
    const line = src.slice(0, m.index).split("\n").length;
    const source = lines[line - 1] ?? "";
    if (/\bt\(|plural\(|className|\bcn\(/.test(source)) continue;
    found.push(`${relative(ROOT, file)}:${line}  expression  ${JSON.stringify(text)}`);
  }

  for (const { re, what } of PATTERNS) {
    for (const m of src.matchAll(re)) {
      const text = m[1].trim();
      if (ALLOWED.has(text)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      // A line already reaching the catalogue is doing the right thing with
      // some other part of itself.
      if (/\bt\(|plural\(/.test(lines[line - 1])) continue;
      found.push(`${relative(ROOT, file)}:${line}  ${what}  ${JSON.stringify(text)}`);
    }
  }
}

/**
 * The other half of the rule, and the half that actually bites: a component
 * asking for a key the catalogue does not have renders the key itself. `t()`
 * falls back rather than throwing -- right at runtime, useless at review time
 * -- so "auth.signIn" appears on the sign-in page and the types are happy.
 */
const catalogue = readFileSync(join(ROOT, "lib/i18n.ts"), "utf8");
const known = new Set([...catalogue.matchAll(/^\s*"([^"]+)":\s*"/gm)].map((m) => m[1]));

for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/\bt\(\s*"([^"${}]+)"/g)) {
    if (!known.has(m[1])) {
      const line = src.slice(0, m.index).split("\n").length;
      found.push(`${relative(ROOT, file)}:${line}  unknown key  ${JSON.stringify(m[1])}`);
    }
  }
  // A plural needs at least the `other` form; every language has one.
  for (const m of src.matchAll(/\bplural\(\s*"([^"${}]+)"/g)) {
    if (!known.has(`${m[1]}.other`)) {
      const line = src.slice(0, m.index).split("\n").length;
      found.push(`${relative(ROOT, file)}:${line}  no plural forms  ${JSON.stringify(m[1])}`);
    }
  }
}

if (found.length) {
  console.error(`${found.length} string${found.length === 1 ? "" : "s"} written into a component:`);
  for (const f of found) console.error("  " + f);
  console.error("\nAdd a key to apps/web/src/lib/i18n.ts and render it with t().");
  process.exit(1);
}
console.log(`${files.length} components, ${known.size} phrases, every word from the catalogue`);
