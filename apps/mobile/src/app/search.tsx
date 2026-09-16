import * as React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Stack, useRouter } from "expo-router";

import { RequireSession } from "@/components/guard";
import { Icon } from "@/components/icon";
import { Body, Empty, Input, Loading, Problem, Title } from "@/components/ui";
import { useGlobalSearch } from "@/lib/queries";
import { space, useTheme } from "@/lib/theme";
import { entityPath } from "@suite/shared/meta";
import { t } from "@suite/shared/i18n";

export default function Search() {
  return (
    <RequireSession>
      <SearchScreen />
    </RequireSession>
  );
}

/**
 * One box against everything. The server searches its index and returns hits
 * grouped by what they are, already filtered to what this person may read, so
 * nothing here decides which entities to ask about.
 */
function SearchScreen() {
  const c = useTheme();
  const router = useRouter();
  const [term, setTerm] = React.useState("");
  const [query, setQuery] = React.useState("");

  // A quarter of a second after the last keystroke, as on the web: the
  // difference between one request and one per letter on a phone connection.
  React.useEffect(() => {
    const id = setTimeout(() => setQuery(term), 250);
    return () => clearTimeout(id);
  }, [term]);

  const results = useGlobalSearch(query);
  const groups = results.data?.groups ?? [];

  return (
    <>
      <Stack.Screen options={{ title: t("nav.search") }} />
      <View style={{ flex: 1 }}>
        <View style={{ padding: space.md }}>
          <Input
            value={term}
            onChangeText={setTerm}
            placeholder={t("palette.placeholder")}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
          {query.trim().length < 2 ? <Empty title={t("palette.hint")} /> : null}
          {results.isPending && query.trim().length >= 2 ? <Loading /> : null}
          {results.error ? <Problem error={results.error} onRetry={() => results.refetch()} /> : null}
          {query.trim().length >= 2 && !results.isPending && !groups.length ? (
            <Empty title={t("palette.nothing")} />
          ) : null}

          {groups.map((g) => (
            <View key={g.entity} style={{ marginTop: space.md }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                  paddingHorizontal: space.lg,
                  paddingBottom: space.xs,
                }}
              >
                <Icon name={g.icon} size={14} color={c.mutedForeground} />
                <Body muted style={{ fontSize: 12, fontWeight: "600" }}>{g.label}</Body>
              </View>

              {g.items.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  onPress={() => router.push(`${entityPath(g.entity)}/${item.id}`)}
                  style={({ pressed }) => ({
                    paddingHorizontal: space.lg,
                    paddingVertical: space.md,
                    minHeight: 52,
                    justifyContent: "center",
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: c.border,
                    backgroundColor: pressed ? c.surfaceMuted : "transparent",
                  })}
                >
                  <Body numberOfLines={1}>{item.title}</Body>
                </Pressable>
              ))}

              {/* The server caps each group, and saying so beats a list that
                  quietly stops. */}
              {g.total > g.items.length ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`${entityPath(g.entity)}?q=${encodeURIComponent(query)}`)}
                  style={{ paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 44 }}
                >
                  <Body style={{ color: c.brand, fontSize: 13 }}>
                    {t("action.seeAllIn", undefined, { n: g.total, label: g.label })}
                  </Body>
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </View>
    </>
  );
}
