/**
 * The shared package, run the way the phone runs it.
 *
 * Browsers carry the whole of `Intl`. Hermes, the engine behind React Native,
 * carries a subset: `NumberFormat` and `DateTimeFormat` are there, and
 * `PluralRules` and `RelativeTimeFormat` are not. Nothing else in this repo
 * could notice — the types are identical, the bundle builds, and the crash
 * arrives on a device, which is exactly what happened: a record count on the
 * app's home screen called `new Intl.PluralRules(…)` and the screen died with
 * "undefined cannot be used as a constructor".
 *
 * So the shared code is exercised here with those two taken away.
 */
const missing = ["PluralRules", "RelativeTimeFormat"];
for (const name of missing) delete Intl[name];

const { plural, t } = await import("../packages/shared/src/i18n.ts");
const { relativeTime, formatMoney, formatDate, formatDateTime, formatQuantity } = await import(
  "../packages/shared/src/format.ts"
);

const failures = [];
const check = (what, got, want) => {
  if (got !== want) failures.push(`${what}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};
const runs = (what, fn) => {
  try {
    const out = fn();
    if (typeof out !== "string" || !out) failures.push(`${what}: returned ${JSON.stringify(out)}`);
  } catch (e) {
    failures.push(`${what}: threw ${e.message}`);
  }
};

// The two forms English has, which is what the fallback has to get right.
check("plural one", plural("record.countRecords", 1), "1 record");
check("plural other", plural("record.countRecords", 2), "2 records");
check("plural zero", plural("record.countRecords", 0), "0 records");
// A key with no forms in the catalogue still must not throw.
runs("plural unknown key", () => plural("nothing.here", 3) || "ok");

runs("relativeTime", () => relativeTime(new Date().toISOString()));
runs("formatMoney", () => formatMoney(123456, "GBP"));
runs("formatDate", () => formatDate("2026-09-16"));
runs("formatDateTime", () => formatDateTime(new Date().toISOString()));
runs("formatQuantity", () => formatQuantity(1500));
runs("t with vars", () => t("invite.join", undefined, { name: "Harbour Supply Co" }));

if (failures.length) {
  console.error(`${failures.length} failure${failures.length === 1 ? "" : "s"} without ${missing.join(" or ")}:`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`shared code survives Hermes' Intl (no ${missing.join(", no ")})`);
