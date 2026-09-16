import * as React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

import { NAV_MODULES } from "@/app/(tabs)/_layout";
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
 * Everything the bottom bar has no room for.
 *
 * The bar carries the first three modules, so this carries the rest — listing
 * all of them again would make this screen and home the same screen, which is
 * what they were. Plus which business you are in and who you are signed in as.
 */
function MoreScreen() {
  const c = useTheme();
  const router = useRouter();
  const session = useSession();
  const meta = useAppMeta();
  const { signOut } = useSessionState();

  const modules = (meta.data?.modules ?? []).slice(NAV_MODULES);

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        {meta.isPending ? <Loading /> : null}
        {meta.error ? <Problem error={meta.error} onRetry={() => meta.refetch()} /> : null}

        <Card>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/approvals")}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingHorizontal: space.lg,
              minHeight: 52,
              backgroundColor: pressed ? c.surfaceMuted : "transparent",
            })}
          >
            <Icon name="CheckSquare" size={16} color={c.brand} />
            <Body style={{ flex: 1 }}>{t("nav.approvals")}</Body>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/reports")}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingHorizontal: space.lg,
              minHeight: 52,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: c.border,
              backgroundColor: pressed ? c.surfaceMuted : "transparent",
            })}
          >
            <Icon name="LayoutDashboard" size={16} color={c.brand} />
            <Body style={{ flex: 1 }}>{t("nav.reports")}</Body>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/till")}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingHorizontal: space.lg,
              minHeight: 52,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: c.border,
              backgroundColor: pressed ? c.surfaceMuted : "transparent",
            })}
          >
            <Icon name="ShoppingCart" size={16} color={c.brand} />
            <Body style={{ flex: 1 }}>{t("nav.till")}</Body>
          </Pressable>
        </Card>

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
