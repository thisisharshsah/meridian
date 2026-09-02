/**
 * The API sends scaled integers, never floats: money in minor units, quantities
 * scaled by 1_000, percentages by 10_000. These helpers are the only place that
 * knows those factors.
 */
export const MONEY_SCALE = 100;
export const QTY_SCALE = 1000;
export const PERCENT_SCALE = 10000;

export function formatMoney(
  minor: number | null | undefined,
  currency = "USD",
  opts: { compact?: boolean; showZero?: boolean } = {},
): string {
  if (minor === null || minor === undefined) return opts.showZero ? formatMoney(0, currency) : "—";
  const value = minor / MONEY_SCALE;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      notation: opts.compact ? "compact" : "standard",
      maximumFractionDigits: opts.compact ? 1 : 2,
      minimumFractionDigits: opts.compact ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/** Editable representation: "1234.50", never a localised string. */
export function moneyToInput(minor: number | null | undefined) {
  if (minor === null || minor === undefined) return "";
  return (minor / MONEY_SCALE).toFixed(2);
}

export function formatQuantity(scaled: number | null | undefined) {
  if (scaled === null || scaled === undefined) return "—";
  const v = scaled / QTY_SCALE;
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function qtyToInput(scaled: number | null | undefined) {
  if (scaled === null || scaled === undefined) return "";
  return formatQuantity(scaled);
}

export function formatPercent(scaled: number | null | undefined) {
  if (scaled === null || scaled === undefined) return "—";
  const v = scaled / PERCENT_SCALE;
  return `${Number.isInteger(v) ? v : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export function percentToInput(scaled: number | null | undefined) {
  if (scaled === null || scaled === undefined) return "";
  const v = scaled / PERCENT_SCALE;
  return String(Number.isInteger(v) ? v : Number(v.toFixed(4)));
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: value.length === 10 ? "UTC" : undefined,
  }).format(d);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

const RELATIVE_STEPS: [number, Intl.RelativeTimeFormatUnit][] = [
  [60, "second"],
  [60, "minute"],
  [24, "hour"],
  [7, "day"],
  [4.348, "week"],
  [12, "month"],
  [Number.POSITIVE_INFINITY, "year"],
];

export function relativeTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  let delta = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [size, unit] of RELATIVE_STEPS) {
    if (Math.abs(delta) < size) return rtf.format(Math.round(delta), unit);
    delta /= size;
  }
  return formatDate(value);
}

/** Days until a date; negative when overdue. */
export function daysUntil(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  const utcToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d.getTime() - utcToday) / 86_400_000);
}

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
