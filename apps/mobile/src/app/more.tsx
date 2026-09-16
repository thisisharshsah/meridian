import * as React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { ChevronsUpDown } from "lucide-react-native";

import { BusinessSheet } from "@/components/business-list";
import { RequireSession } from "@/components/guard";
import { Icon } from "@/components/icon";
import { Body, Button, Card, Label, Loading, Problem, Title } from "@/components/ui";
import { useAppMeta, useSession } from "@/lib/queries";
import { useSessionState } from "@/lib/session";
import { radius, space, useTheme } from "@/lib/theme";
import { entityPath, type ModuleMeta } from "@suite/shared/meta";
import { t } from "@suite/shared/i18n";

export default function More() {
  return (
    <RequireSession>
      <MoreScreen />
    </RequireSession>
  );
}

/**
 * Everything the bottom bar has no room for: every module this business uses,
 * every entity inside it, which business you are in, and who you are signed in
 * as. The drawer the web opens from the same place.
 */
function MoreScreen() {
  const c = useTheme();
  const session = useSession();
  const meta = useAppMeta();
  const { signOut } = useSessionState();
  const [switching, setSwitching] = React.useState(false);

  const modules = meta.data?.modules ?? [];

  return (
    <>
      <Stack.Screen options={{ title: t("nav.more") }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
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
          <Title numberOfLines={1} style={{ fontSize: 18 }}>{session.data?.organization?.name}</Title>
          <ChevronsUpDown size={15} color={c.subtleForeground} />
        </Pressable>

        {meta.isPending ? <Loading /> : null}
        {meta.error ? <Problem error={meta.error} onRetry={() => meta.refetch()} /> : null}

        {modules.map((m) => (
          <ModuleSection key={m.key} module={m} />
        ))}

        <Card style={{ padding: space.lg, gap: space.md }}>
          <View>
            <Label>{t("value.signedInAs")}</Label>
            <Body>{session.data?.user.name}</Body>
            <Body muted style={{ fontSize: 13 }}>{session.data?.user.email}</Body>
          </View>
          <Button title={t("action.signOut")} variant="quiet" onPress={() => void signOut()} />
        </Card>
      </ScrollView>

      <BusinessSheet open={switching} onClose={() => setSwitching(false)} />
    </>
  );
}

/** A module, and every entity in it that this person may open. */
function ModuleSection({ module: m }: { module: ModuleMeta }) {
  const c = useTheme();
  const router = useRouter();

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Icon name={m.icon} size={16} color={c.brand} />
        <Body style={{ fontWeight: "600" }}>{m.label}</Body>
      </View>

      <Card>
        {m.entities.map((e, i) => (
          <Pressable
            key={e.key}
            accessibilityRole="button"
            onPress={() => router.navigate(entityPath(e.key))}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingHorizontal: space.lg,
              minHeight: 52,
              borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: c.border,
              backgroundColor: pressed ? c.surfaceMuted : "transparent",
            })}
          >
            <Icon name={e.icon} size={16} color={c.mutedForeground} />
            <Body style={{ flex: 1 }} numberOfLines={1}>{e.label_plural}</Body>
          </Pressable>
        ))}
      </Card>
    </View>
  );
}
