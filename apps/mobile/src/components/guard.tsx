import * as React from "react";
import { View } from "react-native";
import { Redirect } from "expo-router";

import { Loading } from "@/components/ui";
import { useSessionState } from "@/lib/session";

/**
 * A screen that needs a session.
 *
 * Declarative on purpose: redirecting from an effect runs after the screen has
 * already rendered once, which is how a signed-out person sees a flash of
 * somebody's records before being sent to sign in.
 */
export function RequireSession({ children }: { children: React.ReactNode }) {
  const { status } = useSessionState();

  if (status === "loading") {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Loading />
      </View>
    );
  }
  if (status === "signedOut") return <Redirect href="/sign-in" />;
  return <>{children}</>;
}
