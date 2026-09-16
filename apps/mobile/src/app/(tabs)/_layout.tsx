import * as React from "react";
import { Pressable } from "react-native";
import { Tabs, router } from "expo-router";
import { LayoutDashboard, Menu, Search } from "lucide-react-native";

import { Icon } from "@/components/icon";
import { useAppMeta, useSession } from "@/lib/queries";
import { space, useTheme } from "@/lib/theme";
import { t } from "@suite/shared/i18n";

/** The bar holds home, three modules and the rest; anything further is More. */
export const NAV_MODULES = 3;

/**
 * The five places a phone goes, as real tabs.
 *
 * They were a row of buttons drawn under a stack, so every tap pushed a screen
 * and played a transition, and coming back rebuilt what you had just left. A
 * tab navigator keeps a screen per tab: switching is instant and each one
 * holds its own scroll position and search term. Drilling into a record still
 * pushes, from the root stack, over the bar — which is what a push is for.
 *
 * The middle three are slots rather than named modules. Which module each one
 * holds comes from `/api/meta`, already narrowed to what this business uses
 * and what this person's role may open, so a hotel gets rooms where a shop
 * gets products and neither is named here.
 */
export default function TabsLayout() {
  const c = useTheme();
  const meta = useAppMeta();
  const session = useSession();

  const modules = (meta.data?.modules ?? []).slice(0, NAV_MODULES);
  // Someone with no business sees home's ways-in list and nothing to navigate
  // between; a bar of one item would only be in the way.
  const inside = !!session.data?.organization;

  const search = () => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("nav.search")}
      onPress={() => router.navigate("/search")}
      style={({ pressed }) => ({ padding: space.sm, opacity: pressed ? 0.6 : 1 })}
    >
      <Search size={20} color={c.foreground} />
    </Pressable>
  );

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.foreground,
        headerTitleStyle: { color: c.foreground },
        headerRight: search,
        // A tab builds itself the first time it is opened, not when the bar
        // is drawn: nobody pays for three modules' records to look at home.
        // (`true` is the default; it is the whole point of this screen, so it
        // is written down rather than inherited.)
        lazy: true,
        // A tab that is not being looked at stops re-rendering, and keeps its
        // scroll position and search term for when it is.
        freezeOnBlur: true,
        sceneStyle: { backgroundColor: c.background },
        // Typing in a list's search box should not leave a bar of tabs sitting
        // on top of the keyboard.
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: c.brand,
        tabBarInactiveTintColor: c.mutedForeground,
        tabBarStyle: inside
          ? { backgroundColor: c.surface, borderTopColor: c.border }
          : { display: "none" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          // No business yet means home is the ways-in list, which carries its
          // own heading and wants no chrome above it.
          headerShown: inside,
          title: session.data?.organization?.name || t("nav.home"),
          tabBarLabel: t("nav.home"),
          tabBarIcon: ({ color, size }) => <LayoutDashboard size={size} color={color} />,
        }}
      />

      {[0, 1, 2].map((slot) => {
        const m = modules[slot];
        return (
          <Tabs.Screen
            key={slot}
            name={`m${slot + 1}`}
            options={{
              title: m?.label ?? "",
              tabBarIcon: ({ color, size }) => <Icon name={m?.icon ?? ""} size={size} color={String(color)} />,
              // A business with fewer modules than slots leaves the spare ones
              // out of the bar rather than showing a tab that opens nothing.
              href: m ? undefined : null,
            }}
          />
        );
      })}

      <Tabs.Screen
        name="more"
        options={{
          title: t("nav.more"),
          tabBarIcon: ({ color, size }) => <Menu size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
