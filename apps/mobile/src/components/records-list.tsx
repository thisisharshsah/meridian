import * as React from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Plus } from "lucide-react-native";

import { FieldValue } from "@/components/field-value";
import { FilterChips } from "@/components/filter-chips";
import { Body, Empty, Input, Loading, Problem } from "@/components/ui";
import { useEntityMeta, useRecordList, useSession, type Record_ } from "@/lib/queries";
import { radius, space, useTheme } from "@/lib/theme";
import { entityPath, type EntityMeta } from "@suite/shared/meta";
import { plural, t } from "@suite/shared/i18n";
import { DEFAULT_CURRENCY } from "@suite/shared/constants";

/**
 * One entity's records, wherever they are shown.
 *
 * A module page renders this for whichever of its entities is selected, and a
 * deep link renders it on its own — the same search, filters, count and rows
 * either way, so the two cannot drift.
 */
export function RecordsList({ entityKey, initialSearch = "" }: { entityKey: string; initialSearch?: string }) {
  const meta = useEntityMeta(entityKey);

  if (meta.isPending) return <Loading />;
  if (meta.error) return <Problem error={meta.error} onRetry={() => meta.refetch()} />;
  if (!meta.data) return null;

  // Keyed by entity: moving between the tabs of a module must not carry one
  // entity's search term and filters onto another's records.
  return <Records key={meta.data.key} meta={meta.data} initialSearch={initialSearch} />;
}

function Records({ meta, initialSearch }: { meta: EntityMeta; initialSearch: string }) {
  const c = useTheme();
  const router = useRouter();
  const session = useSession();
  const [search, setSearch] = React.useState(initialSearch);
  const [query, setQuery] = React.useState(initialSearch);
  const [filters, setFilters] = React.useState<Record<string, string>>({});

  // Typing is not a search. A quarter of a second after the last keystroke is
  // what the web waits, and it is the difference between one request and one
  // per letter on a phone connection.
  React.useEffect(() => {
    const id = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(id);
  }, [search]);

  const list = useRecordList(meta.key, query, filters);
  const records = list.data?.pages.flatMap((p) => p.data) ?? [];
  const currency = session.data?.organization?.currency ?? DEFAULT_CURRENCY;

  // What a row says: the title field leads, then the next few list columns as
  // label-and-value pairs. The same choice the web makes on a narrow screen.
  const columns = meta.fields.filter((f) => f.in_list);
  const lead = columns[0];
  const rest = columns.slice(1, 4);

  return (
    <View style={{ flex: 1 }}>
      {meta.fields.some((f) => f.searchable) ? (
        <View style={{ padding: space.md }}>
          <Input
            value={search}
            onChangeText={setSearch}
            placeholder={t("record.searchIn", undefined, { label: meta.label_plural.toLowerCase() })}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
        </View>
      ) : null}

      <FilterChips fields={meta.fields} value={filters} onChange={setFilters} />

      {/* How many there are, which a list that pages as you scroll cannot
          otherwise say. */}
      {list.data ? (
        <Body muted style={{ fontSize: 12, paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          {plural("record.countRecords", list.data.pages[0]?.total ?? 0)}
        </Body>
      ) : null}

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
          list.isPending ? (
            <Loading />
          ) : list.error ? null : (
            <Empty
              title={query ? t("value.noMatches") : t("mobile.noRecords", undefined, { label: meta.label_plural })}
              body={query ? undefined : t("record.createFirstWhy", undefined, { label: meta.label.toLowerCase() })}
            />
          )
        }
        ListFooterComponent={list.isFetchingNextPage ? <Loading /> : null}
        renderItem={({ item }) => (
          <Row
            record={item}
            onPress={() => router.push(`${entityPath(meta.key)}/${item.id}`)}
            lead={lead}
            rest={rest}
            currency={currency}
            meta={meta}
          />
        )}
      />

      {/* Reachable with the thumb that is already holding the phone, and only
          where the person may actually create one. */}
      {meta.permissions.create ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("action.newThing", undefined, { thing: meta.label.toLowerCase() })}
          onPress={() => router.push(`${entityPath(meta.key)}/new`)}
          style={({ pressed }) => ({
            position: "absolute",
            right: space.lg,
            bottom: space.lg,
            width: 52,
            height: 52,
            borderRadius: 26,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? c.brandHover : c.brand,
          })}
        >
          <Plus size={24} color={c.brandForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}

function Row({
  record,
  onPress,
  lead,
  rest,
  currency,
  meta,
}: {
  record: Record_;
  onPress: () => void;
  lead: EntityMeta["fields"][number] | undefined;
  rest: EntityMeta["fields"];
  currency: string;
  meta: EntityMeta;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        gap: space.xs,
        minHeight: 64,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
        backgroundColor: pressed ? c.surfaceMuted : "transparent",
      })}
    >
      {lead ? (
        <FieldValue field={lead} record={record} currency={currency} strong />
      ) : (
        <Body style={{ fontWeight: "600" }}>
          {String(record[meta.title_field] ?? t("value.untitled"))}
        </Body>
      )}

      {/* A grid rather than a wrapping line: the labels share a column and the
          values start at the same place in every row, so the eye runs down one
          field instead of hunting for it in a different position each time. */}
      {rest.map((f) => (
        <View key={f.name} style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
          <Body subtle style={{ fontSize: 12, width: LABEL_COLUMN }} numberOfLines={1}>
            {f.label}
          </Body>
          <View style={{ flex: 1, minWidth: 0 }}>
            <FieldValue field={f} record={record} currency={currency} />
          </View>
        </View>
      ))}
    </Pressable>
  );
}

/**
 * Wide enough for the labels this schema actually uses and narrow enough to
 * leave a value room on a small phone. Fixed, because a column that changes
 * width per row is not a column.
 */
const LABEL_COLUMN = 92;
