import * as React from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { FieldValue } from "@/components/field-value";
import { Body, Empty, Loading, Problem } from "@/components/ui";
import { useRecordList, useSession, useStats } from "@/lib/queries";
import { DEFAULT_CURRENCY } from "@suite/shared/constants";
import { radius, space, toneColors, useTheme } from "@/lib/theme";
import { formatMoney } from "@suite/shared/format";
import { entityPath, optionsOf, type EntityMeta, type FieldDef } from "@suite/shared/meta";
import { plural, t } from "@suite/shared/i18n";

/**
 * A board on a phone is one column at a time.
 *
 * The web puts the stages side by side and drags cards between them, which
 * needs width and a mouse. A phone has neither, so the stages become a row of
 * chips carrying their own count and value, and the records below are the one
 * that is selected. What a board is actually for — how much is sitting in each
 * stage, and what is in the one I am worried about — survives the translation;
 * dragging does not, and a record's stage is changed by opening it.
 */
export function BoardView({ meta, groupField }: { meta: EntityMeta; groupField: FieldDef }) {
  const c = useTheme();
  const router = useRouter();
  const session = useSession();
  const currency = session.data?.organization?.currency ?? DEFAULT_CURRENCY;

  const columns = optionsOf(groupField);
  const [stage, setStage] = React.useState(columns[0]?.value ?? "");

  // One aggregate for every stage rather than a page of records per stage: the
  // counts and values are what the chips are for, and the server can add up.
  const measure = meta.fields.find((f) => f.kind.type === "money" && !f.readonly)?.name;
  const totals = useStats(meta.key, {
    group_by: groupField.name,
    ...(measure ? { measure, agg: "sum" } : {}),
  });
  const byStage = new Map((totals.data?.data ?? []).map((r) => [String(r.bucket), r]));

  const list = useRecordList(meta.key, "", { [groupField.name]: stage });
  const records = list.data?.pages.flatMap((p) => p.data) ?? [];
  const lead = meta.fields.filter((f) => f.in_list)[0];

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{ alignItems: "center", gap: space.xs, paddingHorizontal: space.md, paddingVertical: space.sm }}
      >
        {columns.map((o) => {
          const on = o.value === stage;
          const row = byStage.get(o.value);
          const tone = toneColors(o.tone, c);
          return (
            <Pressable
              key={o.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => setStage(o.value)}
              style={({ pressed }) => ({
                minHeight: 52,
                justifyContent: "center",
                gap: 1,
                paddingHorizontal: space.md,
                borderRadius: radius,
                borderWidth: on ? 2 : StyleSheet.hairlineWidth,
                borderColor: on ? c.brand : c.border,
                backgroundColor: pressed ? c.surfaceMuted : on ? c.brandSubtle : c.surface,
              })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone.fg }} />
                <Text style={{ color: on ? c.brandSubtleForeground : c.foreground, fontSize: 13, fontWeight: "600" }}>
                  {o.label}
                </Text>
                <Text style={{ color: c.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] }}>
                  {row?.count ?? 0}
                </Text>
              </View>
              {measure ? (
                <Text style={{ color: c.mutedForeground, fontSize: 11, fontVariant: ["tabular-nums"] }}>
                  {formatMoney(row?.value ?? 0, currency, { compact: true, showZero: true })}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {list.error ? <Problem error={list.error} onRetry={() => list.refetch()} /> : null}

      <FlatList
        style={{ flex: 1 }}
        data={records}
        keyExtractor={(r) => r.id}
        onRefresh={() => list.refetch()}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListEmptyComponent={
          list.isPending ? <Loading /> : <Empty title={t("board.emptyStage")} body={t("board.emptyStageWhy")} />
        }
        ListFooterComponent={list.isFetchingNextPage ? <Loading /> : null}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`${entityPath(meta.key)}/${item.id}`)}
            style={({ pressed }) => ({
              paddingHorizontal: space.lg,
              paddingVertical: space.md,
              minHeight: 56,
              justifyContent: "center",
              gap: 2,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: c.border,
              backgroundColor: pressed ? c.surfaceMuted : "transparent",
            })}
          >
            {lead ? (
              <FieldValue field={lead} record={item} currency={currency} strong />
            ) : (
              <Body style={{ fontWeight: "600" }}>{String(item[meta.title_field] ?? t("value.untitled"))}</Body>
            )}
            {measure ? (
              <Body muted style={{ fontSize: 13, fontVariant: ["tabular-nums"] }}>
                {formatMoney(item[measure] as number, currency, { showZero: true })}
              </Body>
            ) : null}
          </Pressable>
        )}
      />

      {list.data ? (
        <View
          style={{
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.border,
            paddingHorizontal: space.lg,
            paddingVertical: space.sm,
          }}
        >
          <Body muted style={{ fontSize: 12 }}>
            {plural("record.countRecords", list.data.pages[0]?.total ?? 0)}
          </Body>
        </View>
      ) : null}
    </View>
  );
}

/** Stage, then status: the same rule the web uses, and the same limits. */
export function boardFieldFor(meta: EntityMeta): FieldDef | null {
  for (const name of ["stage", "status"]) {
    const f = meta.fields.find((x) => x.name === name && x.kind.type === "select");
    if (f && optionsOf(f).length >= 2 && optionsOf(f).length <= 8) return f;
  }
  return null;
}
