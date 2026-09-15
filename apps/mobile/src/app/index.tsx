import * as React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";

import { RequireSession } from "@/components/guard";
import { Icon } from "@/components/icon";
import { Body, Button, Card, Label, Loading, Problem, Title } from "@/components/ui";
import { useAppMeta, useSession } from "@/lib/queries";
import { useSessionState } from "@/lib/session";
import { radius, space, useTheme } from "@/lib/theme";
import { entityPath, type ModuleMeta } from "@suite/shared/meta";
import { t } from "@suite/shared/i18n";

export default function Home() {
  return (
    <RequireSession>
      <HomeScreen />
    </RequireSession>
  );
}

function HomeScreen() {
  const session = useSession();
  const meta = useAppMeta();
  const { signOut } = useSessionState();

  if (session.isPending) return <Loading />;
  if (session.error) return <Problem error={session.error} onRetry={() => session.refetch()} />;

  // A real account can belong to no business yet — someone invited who has not
  // accepted, or who signed in with several and picked none.
  if (!session.data?.organization) return <Redirect href="/workspaces" />;

  const modules = meta.data?.modules ?? [];

  return (
    <>
      <Stack.Screen options={{ title: session.data.organization.name }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <View style={{ gap: space.xs }}>
          <Title>{session.data.organization.name}</Title>
          <Body muted>{session.data.product}</Body>
        </View>

        {meta.isPending ? <Loading /> : null}
        {meta.error ? <Problem error={meta.error} onRetry={() => meta.refetch()} /> : null}

        {modules.map((m) => (
          <ModuleCard key={m.key} module={m} />
        ))}

        <Card style={{ padding: space.lg, gap: space.md }}>
          <View>
            <Label>{t("value.signedInAs")}</Label>
            <Body>{session.data.user.name}</Body>
            <Body muted style={{ fontSize: 13 }}>{session.data.user.email}</Body>
          </View>
          {session.data.organizations.length > 1 ? <SwitchButton /> : null}
          <Button title={t("action.signOut")} variant="quiet" onPress={() => void signOut()} />
        </Card>

        <View style={{ height: space.xl }} />
      </ScrollView>
    </>
  );
}

function SwitchButton() {
  const router = useRouter();
  return <Button title={t("workspace.switch")} variant="quiet" onPress={() => router.push("/workspaces")} />;
}

/**
 * A module and the things inside it, drawn from `/api/meta` — the same payload
 * the web builds its sidebar from. Nothing here knows what a deal or an
 * invoice is, so a module added to the server appears here on its own.
 */
function ModuleCard({ module: m }: { module: ModuleMeta }) {
  const c = useTheme();
  const router = useRouter();

  return (
    <Card style={{ padding: space.md, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Icon name={m.icon} size={18} color={c.brand} />
        <Body style={{ fontWeight: "600" }}>{m.label}</Body>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {m.entities.map((e) => (
          <Pressable
            key={e.key}
            accessibilityRole="button"
            onPress={() => router.push(entityPath(e.key))}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              backgroundColor: pressed ? c.surfaceMuted : c.background,
              borderColor: c.border,
              borderWidth: StyleSheet.hairlineWidth,
              borderRadius: radius,
              paddingHorizontal: space.md,
              minHeight: 44,
            })}
          >
            <Icon name={e.icon} size={15} color={c.mutedForeground} />
            <Body style={{ fontSize: 14 }}>{e.label_plural}</Body>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}
