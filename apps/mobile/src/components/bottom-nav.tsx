import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { LayoutDashboard, Menu, Search, type LucideIcon } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/icon";
import { useAppMeta } from "@/lib/queries";
import { space, useTheme } from "@/lib/theme";
import { entityPath } from "@suite/shared/meta";
import { t } from "@suite/shared/i18n";

/**
 * Phone navigation, the same five places the web puts across the bottom of a
 * narrow screen: home, the two screens this business actually lives in,
 * search, and everything else.
 *
 * The middle pair comes from `/api/meta` rather than a hardcoded choice, so it
 * can never offer a screen the person's role cannot open — and a hotel gets
 * rooms where a shop gets products, without either being named here.
 */
export function BottomNav() {
  const c = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const meta = useAppMeta();

  const shortcuts = (meta.data?.modules ?? [])
    .map((m) => m.entities[0])
    .filter((e): e is NonNullable<typeof e> => !!e)
    .slice(0, 2);

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

      {shortcuts.map((e) => {
        const href = entityPath(e.key);
        return (
          <Cell
            key={e.key}
            icon={e.icon}
            label={e.label_plural}
            active={pathname === href || pathname.startsWith(`${href}/`)}
            onPress={() => router.navigate(href)}
          />
        );
      })}

      <Cell
        glyph={Search}
        label={t("nav.search")}
        active={pathname === "/search"}
        onPress={() => router.navigate("/search")}
      />
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
