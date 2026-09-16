import * as React from "react";
import { Pressable, useColorScheme } from "react-native";
import { Stack, router } from "expo-router";
import { Search } from "lucide-react-native";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ApiError } from "@/lib/api";
import { SessionProvider } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { t } from "@suite/shared/i18n";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A phone drops its connection constantly, so retrying is worth it — but
      // only for answers that could differ next time. A 401, 403 or 404 is the
      // server's decision and asking again just spends battery; the 401 that
      // is worth acting on is handled by the token refresh, not here.
      retry: (count, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={client}>
      <SafeAreaProvider>
        <SessionProvider>
          <Chrome />
        </SessionProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

/**
 * The stack over the tabs.
 *
 * `(tabs)` is one screen here and carries its own bar and headers; everything
 * in this stack — a record, a search, the ways in — pushes over it. Tabs
 * switch instantly and keep their state; pushes animate, because arriving at
 * one record from a list of them is a movement and should look like one.
 */
function Chrome() {
  const c = useTheme();
  const scheme = useColorScheme();

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.surface },
          headerTintColor: c.foreground,
          headerTitleStyle: { color: c.foreground },
          contentStyle: { backgroundColor: c.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="sign-up" options={{ headerShown: false }} />
        <Stack.Screen name="new-business" options={{ headerShown: false }} />
        <Stack.Screen
          name="[module]/[entity]/index"
          options={{
            headerRight: () => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("nav.search")}
                onPress={() => router.navigate("/search")}
                style={({ pressed }) => ({ padding: space.sm, opacity: pressed ? 0.6 : 1 })}
              >
                <Search size={20} color={c.foreground} />
              </Pressable>
            ),
          }}
        />
      </Stack>
    </>
  );
}
