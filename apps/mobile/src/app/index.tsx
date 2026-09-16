import * as React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { ChevronsUpDown } from "lucide-react-native";

import { AuthShell } from "@/components/auth-shell";
import { BusinessList, BusinessSheet } from "@/components/business-list";
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

  if (session.isPending) return <Loading />;
  if (session.error) return <Problem error={session.error} onRetry={() => session.refetch()} />;

  // An account can belong to no business yet — someone invited who has not
  // accepted. That is not a different screen, it is this screen with nothing
  // in it yet, so it shows the ways in rather than sending them somewhere.
  if (!session.data?.organization) return <NoBusinessYet />;

  return <Dashboard />;
}

function Dashboard() {
  const c = useTheme();
  const session = useSession();
  const meta = useAppMeta();
  const { signOut } = useSessionState();
  const [switching, setSwitching] = React.useState(false);

  const organization = session.data?.organization;
  const modules = meta.data?.modules ?? [];

  return (
    <>
      <Stack.Screen options={{ title: organization?.name ?? "" }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        {/* The business's name is the heading, and the heading is the switcher:
            this screen is about the business you are in, and choosing another
            is a control on it rather than a screen in front of it. */}
        <View style={{ gap: space.xs }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("workspace.switch")}
            onPress={() => setSwitching(true)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              alignSelf: "flex-start",
              marginLeft: -space.sm,
              paddingHorizontal: space.sm,
              paddingVertical: space.xs,
              borderRadius: radius,
              backgroundColor: pressed ? c.surfaceMuted : "transparent",
            })}
          >
            <Title numberOfLines={1}>{organization?.name}</Title>
            <ChevronsUpDown size={16} color={c.subtleForeground} />
          </Pressable>
          <Body muted>{session.data?.product}</Body>
        </View>

        {meta.isPending ? <Loading /> : null}
        {meta.error ? <Problem error={meta.error} onRetry={() => meta.refetch()} /> : null}

        {modules.map((m) => (
          <ModuleCard key={m.key} module={m} />
        ))}

        <Card style={{ padding: space.lg, gap: space.md }}>
          <View>
            <Label>{t("value.signedInAs")}</Label>
            <Body>{session.data?.user.name}</Body>
            <Body muted style={{ fontSize: 13 }}>{session.data?.user.email}</Body>
          </View>
          <Button title={t("action.signOut")} variant="quiet" onPress={() => void signOut()} />
        </Card>

        <View style={{ height: space.xl }} />
      </ScrollView>

      <BusinessSheet open={switching} onClose={() => setSwitching(false)} />
    </>
  );
}

/** Home, for someone whose account is real but who is not in a business yet. */
function NoBusinessYet() {
  const session = useSession();
  const { signOut } = useSessionState();
  const c = useTheme();
  const first = session.data?.user.name?.split(" ")[0] ?? "";

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <AuthShell
        title={t("choose.title", undefined, { name: first })}
        lede={t("choose.lede")}
        footer={
          <Pressable
            accessibilityRole="button"
            onPress={() => void signOut()}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Body style={{ color: c.brandSubtleForeground }}>{t("action.signOut")}</Body>
          </Pressable>
        }
      >
        <BusinessList />
        <Body muted style={{ fontSize: 12 }}>
          {t("choose.noneWaiting", undefined, { email: session.data?.user.email ?? "" })}
        </Body>
      </AuthShell>
    </>
  );
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
