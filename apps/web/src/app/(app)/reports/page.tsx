"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Icon } from "@/components/icon";
import { get, qs } from "@/lib/api";
import { formatMoney, formatPercent, formatQuantity } from "@/lib/format";
import { useSession } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

type ReportInfo = {
  key: string;
  name: string;
  description: string;
  module: string;
  module_label: string;
  icon: string;
};

type Column = { key: string; label: string; type: string };

type ReportResult = {
  key: string;
  name: string;
  description: string;
  columns: Column[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, number>;
  from: string;
  to: string;
  generated_at: string;
};

const NUMERIC = ["money", "int", "percent", "quantity"];

export default function ReportsPage() {
  const { data: session } = useSession();
  const currency = session?.organization?.currency ?? "USD";

  const [selected, setSelected] = React.useState<string | null>(null);
  const [from, setFrom] = React.useState(() => isoMonthsAgo(12));
  const [to, setTo] = React.useState(() => new Date().toISOString().slice(0, 10));

  const catalog = useQuery({
    queryKey: ["reports"],
    queryFn: () => get<{ data: ReportInfo[] }>("reports"),
  });

  const active = selected ?? catalog.data?.data[0]?.key ?? null;

  const report = useQuery({
    queryKey: ["report", active, from, to],
    queryFn: () => get<ReportResult>(`reports/${active}${qs({ from, to })}`),
    enabled: !!active,
    placeholderData: (prev) => prev,
  });

  // Reports are grouped by module in the picker, matching the sidebar.
  const grouped = React.useMemo(() => {
    const out: Record<string, ReportInfo[]> = {};
    for (const r of catalog.data?.data ?? []) {
      (out[r.module_label] ??= []).push(r);
    }
    return out;
  }, [catalog.data]);

  return (
    <div className="p-5">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">{t("reports.title")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t("reports.lede")}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav className="space-y-4">
          {catalog.isLoading &&
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}

          {Object.entries(grouped).map(([module, reports]) => (
            <div key={module}>
              <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground">
                {module}
              </p>
              <ul className="space-y-0.5">
                {reports.map((r) => (
                  <li key={r.key}>
                    <button
                      type="button"
                      onClick={() => setSelected(r.key)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                        r.key === active
                          ? "bg-sidebar-active font-medium text-foreground"
                          : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                      )}
                    >
                      <Icon name={r.icon} className="size-3.5 shrink-0 opacity-70" />
                      <span className="truncate">{r.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          {!active ? (
            <EmptyState
              icon={BarChart3}
              title={t("reports.noneTitle")}
              description={t("reports.noneBody")}
            />
          ) : report.isLoading && !report.data ? (
            <Skeleton className="h-96 w-full" />
          ) : report.data ? (
            <ReportTable
              result={report.data}
              currency={currency}
              from={from}
              to={to}
              onFrom={setFrom}
              onTo={setTo}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ReportTable({
  result, currency, from, to, onFrom, onTo,
}: {
  result: ReportResult;
  currency: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  const format = (value: unknown, type: string): string => {
    if (value === null || value === undefined) return "—";
    switch (type) {
      case "money":
        return formatMoney(value as number, currency);
      case "percent":
        return formatPercent(value as number);
      case "quantity":
        return formatQuantity(value as number);
      case "int":
        return new Intl.NumberFormat().format(value as number);
      default:
        return String(value);
    }
  };

  // The column a data bar is drawn against: the last money column, which in
  // every one of these reports is the one the rows are ranked by.
  const barColumn = [...result.columns].reverse().find((c) => c.type === "money")?.key;
  const barMax = barColumn
    ? Math.max(...result.rows.map((r) => Math.abs((r[barColumn] as number) ?? 0)), 1)
    : 1;

  const exportCsv = () => {
    const header = result.columns.map((c) => c.label).join(",");
    const lines = result.rows.map((row) =>
      result.columns
        .map((c) => {
          const raw = row[c.key];
          // Export the underlying number, not the formatted string: a
          // spreadsheet should get a value it can add up.
          const value =
            raw === null || raw === undefined
              ? ""
              : c.type === "money"
                ? ((raw as number) / 100).toFixed(2)
                : c.type === "quantity"
                  ? ((raw as number) / 1000).toFixed(3)
                  : c.type === "percent"
                    ? ((raw as number) / 10000).toFixed(2)
                    : String(raw);
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(","),
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.key}-${result.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight">{result.name}</h2>
          <p className="text-xs text-muted-foreground">{result.description}</p>
        </div>

        <div className="flex items-end gap-2">
          <label className="text-xs text-muted-foreground">
            {t("reports.from")}
            <Input
              type="date"
              value={from}
              onChange={(e) => onFrom(e.target.value)}
              className="mt-0.5 w-36"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            To
            <Input type="date" value={to} onChange={(e) => onTo(e.target.value)} className="mt-0.5 w-36" />
          </label>
          <Button variant="secondary" onClick={exportCsv} disabled={!result.rows.length}>
            <Download />
            CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {result.rows.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title={t("reports.emptyTitle")}
              description={t("reports.emptyBody")}
            />
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  {result.columns.map((c) => (
                    <TH key={c.key} className={NUMERIC.includes(c.type) ? "text-right" : ""}>
                      {c.label}
                    </TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {result.rows.map((row, i) => (
                  <TR key={i} className="hover:bg-surface-hover/40">
                    {result.columns.map((c) => {
                      const numeric = NUMERIC.includes(c.type);
                      const isBar = c.key === barColumn;
                      const value = row[c.key];
                      const pct = isBar ? (Math.abs((value as number) ?? 0) / barMax) * 100 : 0;
                      return (
                        <TD
                          key={c.key}
                          className={cn("relative", numeric && "text-right tnum")}
                        >
                          {/* A single-hue bar behind the ranking column: it
                              encodes magnitude, and the number stays readable. */}
                          {isBar && pct > 0 && (
                            <span
                              aria-hidden
                              className="absolute inset-y-1 right-0 rounded-sm bg-brand/12"
                              style={{ width: `${pct}%` }}
                            />
                          )}
                          <span className="relative">
                            {c.type === "text" && value === "Reorder" ? (
                              <Badge tone="warning" dot>{t("reports.reorder")}</Badge>
                            ) : c.type === "text" && value === "Out of stock" ? (
                              <Badge tone="danger" dot>{t("reports.outOfStock")}</Badge>
                            ) : (
                              format(value, c.type)
                            )}
                          </span>
                        </TD>
                      );
                    })}
                  </TR>
                ))}
              </TBody>
              {Object.keys(result.totals).length > 0 && (
                <tfoot>
                  <TR className="border-t-2 border-border font-semibold hover:bg-transparent">
                    {result.columns.map((c, i) => (
                      <TD
                        key={c.key}
                        className={cn(NUMERIC.includes(c.type) && "text-right tnum")}
                      >
                        {i === 0
                          ? "Total"
                          : c.key in result.totals
                            ? format(result.totals[c.key], c.type)
                            : ""}
                      </TD>
                    ))}
                  </TR>
                </tfoot>
              )}
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="mt-2 text-xs text-subtle-foreground">
        {result.rows.length} row{result.rows.length === 1 ? "" : "s"} · generated{" "}
        {new Date(result.generated_at).toLocaleString()}
      </p>
    </div>
  );
}

function isoMonthsAgo(months: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}
