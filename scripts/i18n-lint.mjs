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
