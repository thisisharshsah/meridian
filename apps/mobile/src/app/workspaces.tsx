import * as React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { ArrowRight, Building2, MailPlus, Plus, type LucideIcon } from "lucide-react-native";

import { AuthShell } from "@/components/auth-shell";
import { RequireSession } from "@/components/guard";
import { Body, Button, Loading, Problem } from "@/components/ui";
import { usePendingInvitations, useSession } from "@/lib/queries";
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

/**
 * Which business to open — the same list the web shows, in the same order and
 * with the same three kinds of row: one you are already in, one you have been
 * invited to, and starting one. The last row says "another" only when there is
 * another to speak of.
 */
function WorkspacesScreen() {
  const c = useTheme();
  const router = useRouter();
  const session = useSession();
  const invitations = usePendingInvitations();
  const { switchWorkspace, acceptInvitation, signOut } = useSessionState();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<unknown>(null);

  const run = async (id: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      await work();
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
  const waiting = invitations.data?.data ?? [];
  const first = session.data?.user.name?.split(" ")[0] ?? "";
  const nothingYet = !mine.length && !waiting.length && !invitations.isPending;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <AuthShell
        title={
          mine.length
            ? t("choose.titleReturning", undefined, { name: first })
            : t("choose.title", undefined, { name: first })
        }
        lede={mine.length ? t("choose.ledeReturning") : t("choose.lede")}
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
        <View style={{ gap: space.sm }}>
          {mine.map((o) => (
            <Row
              key={o.id}
              icon={Building2}
              title={o.name}
              subtitle={o.id === current ? t("workspace.current") : undefined}
              dimmed={!!busy && busy !== o.id}
              onPress={() => void run(o.id, () => switchWorkspace(o.id))}
            />
          ))}

          {/* An invitation is a business you are not in yet: same list, its own
              icon, and a verb of its own rather than an arrow. */}
          {waiting.map((inv) => (
            <Row
              key={inv.id}
              icon={MailPlus}
              title={inv.organization}
              subtitle={inv.title ? `${inv.title} · ${inv.role_name}` : inv.role_name}
              dimmed={!!busy && busy !== inv.id}
              action={
                <Button
                  title={t("choose.accept")}
                  busy={busy === inv.id}
                  onPress={() => void run(inv.id, () => acceptInvitation(inv.id))}
                />
              }
            />
          ))}

          <Row
            icon={Plus}
            dashed
            title={mine.length ? t("workspace.create") : t("workspace.createFirst")}
            subtitle={t("choose.startLede")}
            dimmed={!!busy}
            onPress={() => router.push("/new-business")}
          />
        </View>

        {error ? <Problem error={error} /> : null}

        {/* Only when there is nothing else on the screen: otherwise it is a
            note about something nobody asked about. */}
        {nothingYet ? (
          <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingTop: space.md }}>
            <Body muted style={{ fontSize: 12 }}>
              {t("choose.noneWaiting", undefined, { email: session.data?.user.email ?? "" })}
            </Body>
          </View>
        ) : null}
      </AuthShell>
    </>
  );
}

function Row({
  icon: Glyph,
  title,
  subtitle,
  action,
  onPress,
  dashed,
  dimmed,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  onPress?: () => void;
  dashed?: boolean;
  dimmed?: boolean;
}) {
  const c = useTheme();
  const body = (
    <>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: dashed ? c.surfaceMuted : c.brandSubtle,
        }}
      >
        <Glyph size={16} color={dashed ? c.mutedForeground : c.brand} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Body style={{ fontWeight: "600" }} numberOfLines={1}>{title}</Body>
        {subtitle ? <Body muted style={{ fontSize: 12 }} numberOfLines={1}>{subtitle}</Body> : null}
      </View>
      {action ?? (onPress ? <ArrowRight size={16} color={c.subtleForeground} /> : null)}
    </>
  );

  const style = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: space.md,
    padding: space.md,
    minHeight: 60,
    borderRadius: radius,
    borderWidth: dashed ? 1 : StyleSheet.hairlineWidth,
    borderStyle: (dashed ? "dashed" : "solid") as "dashed" | "solid",
    borderColor: c.border,
    opacity: dimmed ? 0.5 : 1,
  };

  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={dimmed}
      onPress={onPress}
      style={({ pressed }) => ({ ...style, backgroundColor: pressed ? c.surfaceMuted : "transparent" })}
    >
      {body}
    </Pressable>
  );
}
