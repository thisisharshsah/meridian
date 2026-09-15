/**
 * Every icon the server names must be one both clients can draw.
 *
 * The client maps icon names explicitly and falls back to a generic glyph for
 * anything it does not know. That fallback is right — a missing icon should
 * never be a blank screen — but it means an unmapped name looks like a design
 * choice rather than a mistake. Ten of them had been rendering as a bulleted
 * list for weeks, including the one on the tax report.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const modules = join(root, "server/src/modules");

const named = new Set();
for (const file of readdirSync(modules).filter((f) => f.endsWith(".rs"))) {
  const src = readFileSync(join(modules, file), "utf8");
  for (const m of src.matchAll(/\bicon:\s*"([A-Za-z0-9]+)"/g)) named.add(m[1]);
}

/** Each client keeps its own table: lucide-react on the web, lucide-react-native on the phone. */
const TABLES = [
  { file: "apps/web/src/components/icon.tsx", client: "web app", from: "lucide-react" },
  { file: "apps/mobile/src/components/icon.tsx", client: "phone app", from: "lucide-react-native" },
];

let failed = false;
for (const { file, client, from } of TABLES) {
  const iconFile = readFileSync(join(root, file), "utf8");
  const table = iconFile.slice(iconFile.indexOf("const ICONS"));
  const mapped = new Set(table.slice(0, table.indexOf("};")).match(/\b[A-Z][A-Za-z0-9]*/g) ?? []);

  const missing = [...named].filter((n) => !mapped.has(n)).sort();
  if (missing.length) {
    failed = true;
    console.error(`${missing.length} icon name${missing.length === 1 ? "" : "s"} the ${client} cannot draw:`);
    for (const m of missing) console.error("  " + m);
    console.error(`\nAdd them to ${file}, importing from ${from}.`);
  }
}
if (failed) process.exit(1);
console.log(`${named.size} icons named by the server, all drawable on both clients`);
