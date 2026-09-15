import * as React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Stack, useRouter } from "expo-router";

import { RequireSession } from "@/components/guard";
import { Body, Button, Card, Empty, Loading, Problem, Title } from "@/components/ui";
import { useSession } from "@/lib/queries";
import { useSessionState } from "@/lib/session";
import { radius, space, useTheme } from "@/lib/theme";
import { t } from "@suite/shared/i18n";

export default function Workspaces() {
  return (
    <RequireSession>
      <WorkspacesScreen />
    </RequireSession>
  );
}

function WorkspacesScreen() {
  const c = useTheme();
  const router = useRouter();
  const session = useSession();
  const { switchWorkspace, signOut } = useSessionState();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<unknown>(null);

  const enter = async (id: string) => {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      await switchWorkspace(id);
      router.replace("/");
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  };

  if (session.isPending) return <Loading />;
  if (session.error) return <Problem error={session.error} onRetry={() => session.refetch()} />;

  const mine = session.data?.organizations ?? [];
  const current = session.data?.organization?.id;

  return (
    <>
      <Stack.Screen options={{ title: t("workspace.switch") }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Title>{t("choose.yours")}</Title>

        {mine.length === 0 ? (
          // Joining or starting a business needs screens the app does not have
          // yet — and saying where to do it beats a dead end.
          <Empty title={t("mobile.noBusiness")} body={t("mobile.noBusinessWhy")} />
        ) : (
          <Card>
            {mine.map((o, i) => (
              <Pressable
                key={o.id}
                accessibilityRole="button"
                disabled={!!busy}
                onPress={() => void enter(o.id)}
                style={({ pressed }) => ({
                  padding: space.lg,
                  minHeight: 56,
                  justifyContent: "center",
                  borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: c.border,
                  borderRadius: radius,
                  backgroundColor: pressed ? c.surfaceMuted : "transparent",
                  opacity: busy && busy !== o.id ? 0.5 : 1,
                })}
              >
                <Body style={{ fontWeight: o.id === current ? "700" : "400" }}>{o.name}</Body>
                {o.id === current ? <Body subtle style={{ fontSize: 12 }}>{t("workspace.current")}</Body> : null}
              </Pressable>
            ))}
          </Card>
        )}

        {error ? <Problem error={error} /> : null}

        <Button title={t("action.signOut")} variant="quiet" onPress={() => void signOut()} />
      </ScrollView>
    </>
  );
}
