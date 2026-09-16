import * as React from "react";
import { Stack, router, usePathname } from "expo-router";
import { Pressable } from "react-native";
import { Search } from "lucide-react-native";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useColorScheme, View } from "react-native";

import { BottomNav } from "@/components/bottom-nav";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/queries";
import { SessionProvider, useSessionState } from "@/lib/session";
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
 * The way in has no navigation to speak of — there is one thing to do on each
 * of those screens — so the bar appears only once someone is inside a
 * business.
 */
const ENTRY_ROUTES = ["/sign-in", "/sign-up", "/invite", "/new-business"];

function Chrome() {
  const c = useTheme();
  const scheme = useColorScheme();
  const pathname = usePathname();
  const { status } = useSessionState();
  const session = useSession();

  const inside =
    status === "signedIn" &&
    !!session.data?.organization &&
    !ENTRY_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.surface },
          headerTintColor: c.foreground,
          headerTitleStyle: { color: c.foreground },
          contentStyle: { backgroundColor: c.background },
          // Search lost its place in the bar to a third module, and a
          // magnifier in the header is where a phone looks for it anyway.
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
      >
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        {/* The one screen that does not need a way to reach itself. */}
        <Stack.Screen name="search" options={{ headerRight: undefined }} />
      </Stack>
      {/* A sibling of the stack rather than something each screen draws, so it
          stays put while screens push and pop over one another. */}
      {inside ? <BottomNav /> : null}
    </View>
  );
}
