import * as React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { useAppMeta } from "@/lib/queries";
import { space, useTheme } from "@/lib/theme";
import { entityPath } from "@suite/shared/meta";

/**
 * The rest of the module, across the top.
 *
 * A module is the page and its entities are its tabs: arriving at Sales means
 * arriving at leads with accounts, deals and quotes one tap away, rather than
 * going back out to a menu to cross between things that belong together.
 *
 * The tabs are the registry's, so a module's shape here is whatever the server
 * says it is, already filtered to what this person may open. A module with one
 * entity has nothing to offer and draws nothing.
 */
export function EntityTabs({ entityKey }: { entityKey: string }) {
  const c = useTheme();
  const router = useRouter();
  const meta = useAppMeta();

  const module = meta.data?.modules.find((m) => m.entities.some((e) => e.key === entityKey));
  const tabs = module?.entities ?? [];
  if (tabs.length < 2) return null;

  return (
    <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space.md, gap: space.xs }}
      >
        {tabs.map((e) => {
          const on = e.key === entityKey;
          return (
            <Pressable
              key={e.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              // `replace`, so moving between tabs does not stack a back entry
              // for every one visited on the way.
              onPress={() => (on ? undefined : router.replace(entityPath(e.key)))}
              style={({ pressed }) => ({
                minHeight: 44,
                justifyContent: "center",
                paddingHorizontal: space.sm,
                borderBottomWidth: 2,
                borderBottomColor: on ? c.brand : "transparent",
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                numberOfLines={1}
                style={{
                  color: on ? c.brand : c.mutedForeground,
                  fontSize: 14,
                  fontWeight: on ? "700" : "500",
                }}
              >
                {e.label_plural}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
