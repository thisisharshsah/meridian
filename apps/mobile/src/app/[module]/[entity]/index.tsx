import * as React from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";

import { RequireSession } from "@/components/guard";
import { FieldValue } from "@/components/field-value";
import { Body, Empty, Input, Loading, Problem } from "@/components/ui";
import { useEntityMeta, useRecordList, useSession, type Record_ } from "@/lib/queries";
import { space, useTheme } from "@/lib/theme";
import { entityKeyFrom, entityPath, type EntityMeta } from "@suite/shared/meta";
import { t } from "@suite/shared/i18n";

export default function List() {
  return (
    <RequireSession>
      <ListScreen />
    </RequireSession>
  );
}

function ListScreen() {
  // `q` arrives when search sends someone here to see the rest of a group.
  const { module, entity, q } = useLocalSearchParams<{ module: string; entity: string; q?: string }>();
  const key = entityKeyFrom(module, entity);
  const meta = useEntityMeta(key);

  if (meta.isPending) return <Loading />;
  if (meta.error) return <Problem error={meta.error} onRetry={() => meta.refetch()} />;
  if (!meta.data) return null;

  return <Records meta={meta.data} initialSearch={q ?? ""} />;
}

function Records({ meta, initialSearch }: { meta: EntityMeta; initialSearch: string }) {
  const router = useRouter();
  const session = useSession();
  const [search, setSearch] = React.useState(initialSearch);
  const [query, setQuery] = React.useState(initialSearch);

  // Typing is not a search. A quarter of a second after the last keystroke is
  // what the web waits, and it is the difference between one request and one
  // per letter on a phone connection.
  React.useEffect(() => {
    const id = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(id);
  }, [search]);

  const list = useRecordList(meta.key, query);
  const records = list.data?.pages.flatMap((p) => p.data) ?? [];
  const currency = session.data?.organization?.currency ?? "USD";

  // What a row says: the title field leads, then the next few list columns as
  // label-and-value pairs. The same choice the web makes on a narrow screen.
  const columns = meta.fields.filter((f) => f.in_list);
  const lead = columns[0];
  const rest = columns.slice(1, 4);

  return (
    <>
      <Stack.Screen options={{ title: meta.label_plural }} />
      <View style={{ flex: 1 }}>
        {meta.fields.some((f) => f.searchable) ? (
          <View style={{ padding: space.md }}>
            <Input
              value={search}
              onChangeText={setSearch}
              placeholder={t("record.searchPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
            />
          </View>
        ) : null}

        {list.isPending ? <Loading /> : null}
        {list.error ? <Problem error={list.error} onRetry={() => list.refetch()} /> : null}

        <FlatList
          data={records}
          keyExtractor={(r) => r.id}
          onRefresh={() => list.refetch()}
          refreshing={list.isRefetching && !list.isFetchingNextPage}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          ListEmptyComponent={
            list.isPending || list.error ? null : (
              <Empty
                title={query ? t("value.noMatches") : t("mobile.noRecords", undefined, { label: meta.label_plural })}
                body={query ? undefined : t("mobile.noRecordsWhy")}
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
      </View>
    </>
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
        {rest.map((f) => (
          <View key={f.name} style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Body subtle style={{ fontSize: 12 }}>{f.label}</Body>
            <View style={{ maxWidth: 200 }}>
              <FieldValue field={f} record={record} currency={currency} />
            </View>
          </View>
        ))}
      </View>
    </Pressable>
  );
}
