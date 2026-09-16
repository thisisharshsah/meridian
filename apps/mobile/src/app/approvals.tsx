import * as React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Stack, useRouter } from "expo-router";

import { RequireSession } from "@/components/guard";
import { Body, Button, Card, Empty, Loading, Problem, Title } from "@/components/ui";
import { useApprovals, useDecideApproval, type ApprovalRequest } from "@/lib/queries";
import { radius, space, toneColors, useTheme } from "@/lib/theme";
import { relativeTime } from "@suite/shared/format";
import { entityPath } from "@suite/shared/meta";
import { t } from "@suite/shared/i18n";

type Scope = "pending" | "mine" | "decided";

export default function Approvals() {
  return (
    <RequireSession>
      <ApprovalsScreen />
    </RequireSession>
  );
}

/**
 * Decisions waiting on you.
 *
 * Approving writes a value back onto the record — an expense over a threshold
 * sits at submitted until Finance approves it, at which point its status
 * becomes approved — so this is not a notification list, it is the act itself.
 * Which is exactly why it belongs on a phone: the person who has to decide is
 * usually not at a desk.
 */
function ApprovalsScreen() {
  const c = useTheme();
  const [scope, setScope] = React.useState<Scope>("pending");
  const requests = useApprovals(scope);
  const decide = useDecideApproval();

  const rows = requests.data?.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: t("nav.approvals") }} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", gap: space.xs, padding: space.md }}>
          {(
            [
              ["pending", t("approvals.waitingOnYou")],
              ["mine", t("approvals.youAskedFor")],
              ["decided", t("approvals.decided")],
            ] as const
          ).map(([key, label]) => {
            const on = key === scope;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setScope(key)}
                style={({ pressed }) => ({
                  minHeight: 32,
                  justifyContent: "center",
                  paddingHorizontal: space.md,
                  borderRadius: 999,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: on ? c.brand : c.border,
                  backgroundColor: pressed ? c.surfaceMuted : on ? c.brandSubtle : c.surface,
                })}
              >
                <Body
                  style={{
                    fontSize: 13,
                    fontWeight: on ? "700" : "500",
                    color: on ? c.brandSubtleForeground : c.mutedForeground,
                  }}
                >
                  {label}
                </Body>
              </Pressable>
            );
          })}
        </View>

        <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.md }}>
          {requests.isPending ? <Loading /> : null}
          {requests.error ? <Problem error={requests.error} onRetry={() => requests.refetch()} /> : null}
          {!requests.isPending && !rows.length ? (
            <Empty
              title={scope === "decided" ? t("approvals.noneDecided") : t("approvals.nothingWaiting")}
              body={scope === "pending" ? t("approvals.rulesNote") : undefined}
            />
          ) : null}

          {rows.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              busy={decide.isPending}
              onDecide={(decision) => decide.mutate({ id: r.id, decision })}
            />
          ))}
        </ScrollView>
      </View>
    </>
  );
}

function RequestCard({
  request: r,
  busy,
  onDecide,
}: {
  request: ApprovalRequest;
  busy: boolean;
  onDecide: (decision: "approved" | "rejected") => void;
}) {
  const c = useTheme();
  const router = useRouter();
  const tone = toneColors(
    r.status === "approved" ? "success" : r.status === "rejected" ? "danger" : "warning",
    c,
  );

  return (
    <Card style={{ padding: space.lg, gap: space.md }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(`${entityPath(r.entity)}/${r.record_id}`)}
        style={{ gap: space.xs }}
      >
        <Body style={{ fontWeight: "600" }}>{r.record_title ?? t("value.untitled")}</Body>
        {r.summary ? <Body muted style={{ fontSize: 13 }}>{r.summary}</Body> : null}
        <Body subtle style={{ fontSize: 12 }}>
          {[r.rule_name, r.requested_by_name, relativeTime(r.created_at)].filter(Boolean).join(" · ")}
        </Body>
      </Pressable>

      {r.status === "pending" ? (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button title={t("approvals.approve")} onPress={() => onDecide("approved")} busy={busy} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title={t("approvals.reject")} variant="quiet" onPress={() => onDecide("rejected")} disabled={busy} />
          </View>
        </View>
      ) : (
        <View
          style={{
            alignSelf: "flex-start",
            backgroundColor: tone.bg,
            borderRadius: radius,
            paddingHorizontal: space.sm,
            paddingVertical: 2,
          }}
        >
          <Body style={{ color: tone.fg, fontSize: 12, fontWeight: "600" }}>
            {[r.status === "approved" ? t("approvals.approved") : t("approvals.rejected"), r.decided_by_name]
              .filter(Boolean)
              .join(" · ")}
          </Body>
        </View>
      )}
    </Card>
  );
}
