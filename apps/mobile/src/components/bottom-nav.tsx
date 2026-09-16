import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { LayoutDashboard, Menu, type LucideIcon } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { useAppMeta } from "@/lib/queries";
import { space, useTheme } from "@/lib/theme";
import { entityPath } from "@suite/shared/meta";
import { t } from "@suite/shared/i18n";

/** The bar holds home, three modules and the rest; anything further is More. */
export const NAV_MODULES = 3;

/**
 * Phone navigation: five places, and three of them are this business's own.
 *
 * A module is a page and its entities are its tabs, so tapping Sales lands on
 * leads with accounts, deals and quotes across the top — crossing between
 * things that belong together costs a tap, not a trip back to a menu.
 *
 * Which three is not a decision made here. They are the first modules
 * `/api/meta` returns, already narrowed to what this business uses and what
 * this person's role may open, so a hotel gets rooms where a shop gets
 * products and neither is named in this file.
 */
export function BottomNav() {
  const c = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const meta = useAppMeta();

  const modules = (meta.data?.modules ?? []).slice(0, NAV_MODULES);

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={t("nav.primary")}
      style={{
        flexDirection: "row",
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        backgroundColor: c.surface,
        // Clear of the home indicator, which otherwise sits over the last item.
        paddingBottom: insets.bottom,
      }}
    >
      <Cell
        glyph={LayoutDashboard}
        label={t("nav.home")}
        active={pathname === "/"}
        onPress={() => router.navigate("/")}
      />

      {modules.map((m) => {
        // The module's page is its first entity; the tabs on that screen are
        // the rest of it.
        const first = m.entities[0];
        if (!first) return null;
        return (
          <Cell
            key={m.key}
            icon={m.icon}
            label={m.label}
            active={pathname.startsWith(`/${m.key}/`)}
            onPress={() => router.navigate(entityPath(first.key))}
          />
        );
      })}

      <Cell
        glyph={Menu}
        label={t("nav.more")}
        active={pathname === "/more"}
        onPress={() => router.navigate("/more")}
      />
    </View>
  );
}

function Cell({
  glyph: Glyph,
  icon,
  label,
  active,
  onPress,
}: {
  glyph?: LucideIcon;
  icon?: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const c = useTheme();
  const color = active ? c.brand : c.mutedForeground;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 56,
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        paddingHorizontal: space.xs,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {Glyph ? <Glyph size={20} color={color} /> : <Icon name={icon ?? ""} size={20} color={color} />}
      <Text numberOfLines={1} style={{ color, fontSize: 11, fontWeight: "600", maxWidth: "100%" }}>
        {label}
      </Text>
    </Pressable>
  );
}
