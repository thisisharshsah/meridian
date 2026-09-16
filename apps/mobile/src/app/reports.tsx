import * as React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { RequireSession } from "@/components/guard";
import { Body, Card, Empty, Label, Loading, Picker, Problem } from "@/components/ui";
import { get, qs } from "@/lib/api";
import { useSession } from "@/lib/queries";
import { radius, space, useTheme } from "@/lib/theme";
import { DEFAULT_CURRENCY } from "@suite/shared/constants";
import { formatDate, formatMoney, formatPercent, formatQuantity } from "@suite/shared/format";
import { t } from "@suite/shared/i18n";

type ReportInfo = { key: string; name: string; description: string; module: string };
type Column = { key: string; label: string; type: string };
type ReportResult = {
  key: string;
  name: string;
  description: string;
  columns: Column[];
  rows: Record<string, string | number | boolean | null>[];
  totals: Record<string, number>;
  from: string;
  to: string;
};

export default function Reports() {
  return (
    <RequireSession>
      <ReportsScreen />
    </RequireSession>
  );
}

/**
 * The ten cross-module reports, on a phone.
 *
 * Each is a named query answering `{columns, rows, totals}` where every column
 * carries its own type — so this renders all of them with one grid and formats
 * a money column as money because the column says it is money. There is no
 * per-report code here, and adding a report to the server adds it here.
 *
 * A report is a table and a table is wider than a phone, so the grid scrolls
 * sideways with the first column pinned: the row has to keep saying what it is
 * about while the numbers move.
 */
function ReportsScreen() {
  const c = useTheme();
  const session = useSession();
  const currency = session.data?.organization?.currency ?? DEFAULT_CURRENCY;
  const [active, setActive] = React.useState<string | null>(null);

  const catalog = useQuery({
    queryKey: ["reports"],
    queryFn: () => get<{ data: ReportInfo[] }>("reports"),
    staleTime: Infinity,
  });

  const reports = catalog.data?.data ?? [];
  const chosen = active ?? reports[0]?.key ?? null;

  const result = useQuery({
    queryKey: ["report", chosen],
    queryFn: () => get<ReportResult>(`reports/${chosen}${qs({})}`),
    enabled: !!chosen,
  });

  return (
    <>
      <Stack.Screen options={{ title: t("nav.reports") }} />
      <View style={{ flex: 1 }}>
        <View style={{ padding: space.md, gap: space.sm }}>
          {catalog.isPending ? <Loading /> : null}
          {catalog.error ? <Problem error={catalog.error} onRetry={() => catalog.refetch()} /> : null}
          {reports.length ? (
            <Picker
              label={t("nav.reports")}
              value={chosen ?? ""}
              onChange={setActive}
              options={reports.map((r) => ({ value: r.key, label: r.name }))}
            />
          ) : null}
          {result.data?.description ? (
            <Body muted style={{ fontSize: 12 }}>{result.data.description}</Body>
          ) : null}
        </View>

        {result.isPending && chosen ? <Loading /> : null}
        {result.error ? <Problem error={result.error} onRetry={() => result.refetch()} /> : null}
        {result.data ? <Grid report={result.data} currency={currency} /> : null}
        {!catalog.isPending && !reports.length ? <Empty title={t("reports.none")} /> : null}
      </View>
    </>
  );
}

const NUMERIC = ["money", "int", "percent", "quantity"];

function Grid({ report, currency }: { report: ReportResult; currency: string }) {
  const c = useTheme();
  const [lead, ...rest] = report.columns;
  if (!lead) return null;

  if (!report.rows.length) {
    return <Empty title={t("reports.noRows")} body={t("reports.noRowsWhy")} />;
  }

  const cell = (col: Column, value: unknown) => {
    if (value === null || value === undefined || value === "") return "—";
    switch (col.type) {
      case "money": return formatMoney(value as number, currency, { showZero: true });
      case "percent": return formatPercent(value as number);
      case "quantity": return formatQuantity(value as number);
      case "date": return formatDate(value as string);
      default: return String(value);
    }
  };

  return (
    <ScrollView style={{ flex: 1 }}>
      <View style={{ flexDirection: "row" }}>
        {/* The first column stays put: a row of numbers with nothing saying
            whose they are is not a report. */}
        <View style={{ borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.border }}>
          <HeaderCell label={lead.label} width={140} />
          {report.rows.map((row, i) => (
            <BodyCell key={i} text={cell(lead, row[lead.key])} width={140} striped={i % 2 === 1} />
          ))}
          {Object.keys(report.totals).length ? <TotalCell text={t("reports.total")} width={140} /> : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            <View style={{ flexDirection: "row" }}>
              {rest.map((col) => (
                <HeaderCell key={col.key} label={col.label} width={columnWidth(col)} numeric={NUMERIC.includes(col.type)} />
              ))}
            </View>
            {report.rows.map((row, i) => (
              <View key={i} style={{ flexDirection: "row" }}>
                {rest.map((col) => (
                  <BodyCell
                    key={col.key}
                    text={cell(col, row[col.key])}
                    width={columnWidth(col)}
                    numeric={NUMERIC.includes(col.type)}
                    striped={i % 2 === 1}
                  />
                ))}
              </View>
            ))}
            {Object.keys(report.totals).length ? (
              <View style={{ flexDirection: "row" }}>
                {rest.map((col) => (
                  <TotalCell
                    key={col.key}
                    text={col.key in report.totals ? cell(col, report.totals[col.key]) : ""}
                    width={columnWidth(col)}
                    numeric={NUMERIC.includes(col.type)}
                  />
                ))}
              </View>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </ScrollView>
  );
}

/** Numbers need less room than names, and dates less than either. */
function columnWidth(col: Column) {
  if (NUMERIC.includes(col.type)) return 110;
  if (col.type === "date") return 110;
  return 140;
}

function HeaderCell({ label, width, numeric }: { label: string; width: number; numeric?: boolean }) {
  const c = useTheme();
  return (
    <View
      style={{
        width,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        backgroundColor: c.surfaceMuted,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
      }}
    >
      <Text
        numberOfLines={1}
        style={{ color: c.mutedForeground, fontSize: 11, fontWeight: "700", textAlign: numeric ? "right" : "left" }}
      >
        {label}
      </Text>
    </View>
  );
}

function BodyCell({
  text,
  width,
  numeric,
  striped,
}: {
  text: string;
  width: number;
  numeric?: boolean;
  striped?: boolean;
}) {
  const c = useTheme();
  return (
    <View
      style={{
        width,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        minHeight: 40,
        justifyContent: "center",
        backgroundColor: striped ? c.surfaceMuted : "transparent",
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          color: c.foreground,
          fontSize: 13,
          textAlign: numeric ? "right" : "left",
          fontVariant: numeric ? ["tabular-nums"] : undefined,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

function TotalCell({ text, width, numeric }: { text: string; width: number; numeric?: boolean }) {
  const c = useTheme();
  return (
    <View
      style={{
        width,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        minHeight: 44,
        justifyContent: "center",
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.borderStrong,
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          color: c.foreground,
          fontSize: 13,
          fontWeight: "700",
          textAlign: numeric ? "right" : "left",
          fontVariant: numeric ? ["tabular-nums"] : undefined,
        }}
      >
        {text}
      </Text>
    </View>
  );
}
