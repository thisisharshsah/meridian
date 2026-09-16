import * as React from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronsUpDown, Search } from "lucide-react-native";

import { useChrome } from "@/components/chrome";
import { useSession } from "@/lib/queries";
import { space, useTheme } from "@/lib/theme";
import { t } from "@suite/shared/i18n";

/**
 * What the bar says, and what it does.
 *
 * It used to repeat the tab's own label — "Customers" above a bar with
 * "Customers" lit up in it — which spent the width of a phone saying the same
 * word twice. The tabs say where you are; the bar says which business you are
 * in, because that is the one thing no other part of the screen shows and the
 * one that must never be mistaken.
 */
export function AppBarTitle() {
  const c = useTheme();
  const { openBusinesses } = useChrome();
  const session = useSession();
  const name = session.data?.organization?.name;
  if (!name) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("workspace.switch")}
      onPress={openBusinesses}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 17, fontWeight: "700", maxWidth: 220 }}>
        {name}
      </Text>
      <ChevronsUpDown size={14} color={c.subtleForeground} />
    </Pressable>
  );
}

export function AppBarSearch() {
  const c = useTheme();
  const { openSearch } = useChrome();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("nav.search")}
      onPress={openSearch}
      style={({ pressed }) => ({ padding: space.sm, opacity: pressed ? 0.6 : 1 })}
    >
      <Search size={20} color={c.foreground} />
    </Pressable>
  );
}

/** The same pair for a pushed screen, which keeps its own title and back arrow. */
export function AppBarCompany() {
  const c = useTheme();
  const { openBusinesses } = useChrome();
  const session = useSession();
  const name = session.data?.organization?.name;

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {name ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("workspace.switch")}
          onPress={openBusinesses}
          style={({ pressed }) => ({ paddingHorizontal: space.sm, opacity: pressed ? 0.6 : 1 })}
        >
          <Text numberOfLines={1} style={{ color: c.mutedForeground, fontSize: 13, maxWidth: 120 }}>
            {name}
          </Text>
        </Pressable>
      ) : null}
      <AppBarSearch />
    </View>
  );
}
