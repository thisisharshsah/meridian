import * as React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useColorScheme } from "react-native";

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
          <Chrome />
        </SessionProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

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
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
