import * as React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { space, useTheme } from "@/lib/theme";
import type { ModuleEntity } from "@suite/shared/meta";

/**
 * The rest of the module, across the top.
 *
 * Controlled rather than routed. These used to be links: each tap replaced the
 * screen, so moving from leads to deals played a screen transition and threw
 * the list away to build another one. Which entity is showing is state on the
 * module's page, so switching is a re-render and nothing slides.
 *
 * A module with one entity has nothing to offer and draws nothing.
 */
export function EntityTabs({
  entities,
  value,
  onChange,
}: {
  entities: ModuleEntity[];
  value: string;
  onChange: (key: string) => void;
}) {
  const c = useTheme();
  if (entities.length < 2) return null;

  return (
    <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space.md, gap: space.xs }}
      >
        {entities.map((e) => {
          const on = e.key === value;
          return (
            <Pressable
              key={e.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => (on ? undefined : onChange(e.key))}
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
