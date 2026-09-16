import * as React from "react";
import { useColorScheme } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppBarCompany } from "@/components/app-bar";
import { ChromeProvider } from "@/components/chrome";
import { ApiError } from "@/lib/api";
import { SessionProvider } from "@/lib/session";
import { useTheme } from "@/lib/theme";

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
          <ChromeProvider>
            <Shell />
          </ChromeProvider>
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
function Shell() {
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
        {/* A pushed screen keeps its own title and back arrow; the business
            and search ride along on the right. */}
        <Stack.Screen name="[module]/[entity]/index" options={{ headerRight: () => <AppBarCompany /> }} />
        <Stack.Screen name="[module]/[entity]/[id]/index" options={{ headerRight: () => <AppBarCompany /> }} />
      </Stack>
    </>
  );
}
