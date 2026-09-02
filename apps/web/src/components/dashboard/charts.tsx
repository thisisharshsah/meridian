"use client";

import * as React from "react";

import { Badge, toneOf } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import type { StatsRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * Both charts here answer a magnitude question ("how much sits in each bucket"),
 * so they use ONE hue scaled by length rather than a colour per category.
 *
 * That is deliberate: the status palette (success/warning/danger…) fails
 * colour-blind separation when it has to carry identity on its own — red and
 * green sit at ΔE ~4 for deuteranopia. Status colour still appears, but as a
 * badge next to a text label, where colour reinforces a word instead of
 * replacing it.
 */

type Row = { key: string; label: string; value: number; count: number; tone?: string };

function Bars({
  rows,
  currency,
  renderLabel,
  emptyLabel,
}: {
  rows: Row[];
  currency: string;
  renderLabel?: (row: Row) => React.ReactNode;
  emptyLabel: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  const total = rows.reduce((s, r) => s + r.value, 0);

  if (!rows.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div>
      <ul className="space-y-2.5">
        {rows.map((r) => {
          const pct = (r.value / max) * 100;
          const share = total > 0 ? (r.value / total) * 100 : 0;
          return (
            <li
              key={r.key}
              className="group"
              title={`${r.label}: ${formatMoney(r.value, currency)} · ${r.count} record${r.count === 1 ? "" : "s"} · ${share.toFixed(0)}% of total`}
            >
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5 text-xs">
                  {renderLabel ? renderLabel(r) : <span className="truncate">{r.label}</span>}
                  <span className="shrink-0 text-subtle-foreground">
                    {r.count} record{r.count === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-medium tnum">
                  {formatMoney(r.value, currency, { compact: true })}
                </span>
              </div>

              {/* Recessive track, single-hue fill, rounded data-end. */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out group-hover:brightness-110"
                  style={{ width: `${Math.max(pct, r.value > 0 ? 2 : 0)}%` }}
                  role="presentation"
                />
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
        Total{" "}
        <span className="font-medium text-foreground tnum">{formatMoney(total, currency)}</span>
      </p>
    </div>
  );
}

const STAGE_ORDER = ["qualification", "needs_analysis", "proposal", "negotiation"];

export function PipelineChart({ rows, currency }: { rows: StatsRow[]; currency: string }) {
  const mapped: Row[] = rows
    .map((r) => ({
      key: String(r.bucket),
      label: humanise(String(r.bucket)),
      value: r.value,
      count: r.count,
    }))
    // Funnel order beats value order: a pipeline is read as a sequence.
    .sort((a, b) => rank(a.key) - rank(b.key));

  return <Bars rows={mapped} currency={currency} emptyLabel="No open deals." />;
}

function rank(stage: string) {
  const i = STAGE_ORDER.indexOf(stage);
  return i === -1 ? STAGE_ORDER.length : i;
}

const INVOICE_TONES: Record<string, string> = {
  draft: "neutral",
  sent: "info",
  partial: "warning",
  paid: "success",
  overdue: "danger",
  void: "neutral",
};

export function StatusBars({ rows, currency }: { rows: StatsRow[]; currency: string }) {
  const mapped: Row[] = rows
    .map((r) => ({
      key: String(r.bucket),
      label: humanise(String(r.bucket)),
      value: r.value,
      count: r.count,
      tone: INVOICE_TONES[String(r.bucket)] ?? "neutral",
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <Bars
      rows={mapped}
      currency={currency}
      emptyLabel="No invoices yet."
      // Status colour rides along with the status word, never on its own.
      renderLabel={(r) => (
        <Badge tone={toneOf(r.tone)} dot className={cn("shrink-0")}>
          {r.label}
        </Badge>
      )}
    />
  );
}

function humanise(s: string) {
  return s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
