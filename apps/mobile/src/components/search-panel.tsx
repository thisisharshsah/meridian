import * as React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { X } from "lucide-react-native";

import { Icon } from "@/components/icon";
import { Body, Empty, Input, Loading, Problem } from "@/components/ui";
import { useGlobalSearch } from "@/lib/queries";
import { space, useTheme } from "@/lib/theme";
import { entityPath } from "@suite/shared/meta";
import { t } from "@suite/shared/i18n";

/**
 * One box against everything, opened over whatever page you were on.
 *
 * It was a screen of its own, which meant navigating away from the thing you
 * wanted to search from and navigating back afterwards. The server searches
 * its index and returns hits grouped by what they are, already filtered to
 * what this person may read, so nothing here decides which entities to ask
 * about.
 */
export function SearchPanel({ onClose }: { onClose: () => void }) {
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
  const asked = query.trim().length >= 2;

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          padding: space.md,
          backgroundColor: c.surface,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: c.border,
        }}
      >
        <View style={{ flex: 1 }}>
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("record.close")}
          onPress={onClose}
          style={({ pressed }) => ({ padding: space.sm, opacity: pressed ? 0.6 : 1 })}
        >
          <X size={20} color={c.foreground} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
        {!asked ? <Empty title={t("palette.hint")} /> : null}
        {asked && results.isPending ? <Loading /> : null}
        {results.error ? <Problem error={results.error} onRetry={() => results.refetch()} /> : null}
        {asked && !results.isPending && !groups.length ? <Empty title={t("palette.nothing")} /> : null}

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
                onPress={() => go(`${entityPath(g.entity)}/${item.id}`)}
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
                onPress={() => go(`${entityPath(g.entity)}?q=${encodeURIComponent(query)}`)}
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
  );
}
