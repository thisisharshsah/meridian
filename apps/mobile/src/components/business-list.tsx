import * as React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { ArrowRight, Building2, Check, MailPlus, Plus, type LucideIcon } from "lucide-react-native";

import { Body, Button, Problem, Title } from "@/components/ui";
import { usePendingInvitations, useSession } from "@/lib/queries";
import { useSessionState } from "@/lib/session";
import { radius, space, useTheme } from "@/lib/theme";
import { t } from "@suite/shared/i18n";

/**
 * Every way to be in a business, as one list: the ones you are in, the
 * invitations waiting for your address, and starting another.
 *
 * It is the whole of the old "choose a business" screen, which everybody with
 * more than one had to pass through before they could work. Now it is a
 * control — opened from the home screen's own title — and the same list serves
 * the other case, where somebody has no business at all and home has nothing
 * else to show.
 */
export function BusinessList({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const session = useSession();
  const invitations = usePendingInvitations();
  const { switchWorkspace, acceptInvitation } = useSessionState();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<unknown>(null);

  const run = async (id: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      await work();
      onDone?.();
      router.replace("/");
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  };

  const mine = session.data?.organizations ?? [];
  const current = session.data?.organization?.id;
  const waiting = invitations.data?.data ?? [];

  return (
    <View style={{ gap: space.sm }}>
      {mine.map((o) => (
        <Row
          key={o.id}
          icon={o.id === current ? Check : Building2}
          title={o.name}
          subtitle={o.id === current ? t("workspace.current") : undefined}
          dimmed={!!busy && busy !== o.id}
          onPress={o.id === current ? undefined : () => void run(o.id, () => switchWorkspace(o.id))}
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
        onPress={() => {
          onDone?.();
          router.push("/new-business");
        }}
      />

      {error ? <Problem error={error} /> : null}
    </View>
  );
}

/** The list as a sheet, opened from the home screen's title. */
export function BusinessSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const c = useTheme();
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "#0006" }} onPress={onClose} />
      <View
        style={{
          maxHeight: "75%",
          backgroundColor: c.surface,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          paddingTop: space.lg,
        }}
      >
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.md }}>
          <Title style={{ fontSize: 18 }}>{t("workspace.switch")}</Title>
          <BusinessList onDone={onClose} />
        </ScrollView>
      </View>
    </Modal>
  );
}

export function Row({
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
