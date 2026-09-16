import * as React from "react";
import { Alert, Pressable, ScrollView, Share, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2 } from "lucide-react-native";

import { RequireSession } from "@/components/guard";
import { Body, Button, Card, Empty, Input, Label, Loading, Picker, Problem, Title } from "@/components/ui";
import { ApiError, API_BASE, del, get, patch, post } from "@/lib/api";
import { useSession } from "@/lib/queries";
import { radius, space, useTheme } from "@/lib/theme";
import { CURRENCIES } from "@suite/shared/constants";
import { formatDate } from "@suite/shared/format";
import { t } from "@suite/shared/i18n";

type Org = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  fiscal_year_start_month: number;
  member_count: number;
  can_edit: boolean;
};
type Member = {
  membership_id: string;
  name: string;
  email: string;
  status: string;
  is_owner: boolean;
  role_id: string | null;
  role_name: string | null;
};
type Role = { id: string; name: string; key: string };
type Invitation = { id: string; email: string; role_name: string | null; expires_at: string };

export default function Settings() {
  return (
    <RequireSession>
      <SettingsScreen />
    </RequireSession>
  );
}

/**
 * The settings worth having away from a desk: what the business is called and
 * charges in, who is in it, and inviting somebody else.
 *
 * The rest — the role matrix, automation rules, webhooks — are screens for a
 * wide one. They are deliberately not half-built here: a permission matrix
 * squeezed onto a phone is how a role ends up granting something nobody meant
 * to grant.
 */
function SettingsScreen() {
  const session = useSession();
  const org = useQuery({ queryKey: ["settings", "org"], queryFn: () => get<Org>("settings/organization") });

  if (org.isPending) return <Loading />;
  if (org.error) return <Problem error={org.error} onRetry={() => org.refetch()} />;
  if (!org.data) return null;

  return (
    <>
      <Stack.Screen options={{ title: t("nav.settings") }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        <Business org={org.data} />
        <Members canEdit={org.data.can_edit || !!session.data?.is_owner} />
        <Invitations />
        <ElsewhereNote />
      </ScrollView>
    </>
  );
}

/** What the business is called and what it charges in. */
function Business({ org }: { org: Org }) {
  const c = useTheme();
  const qc = useQueryClient();
  const [name, setName] = React.useState(org.name);
  const [currency, setCurrency] = React.useState(org.currency);
  const [error, setError] = React.useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => patch<Org>("settings/organization", { name: name.trim(), currency }),
    onSuccess: () => {
      // The name is in the app bar and the currency formats every figure on
      // every screen, so nothing cached still speaks for the old ones.
      qc.invalidateQueries();
      Alert.alert(t("settings.saved"));
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t("record.somethingWrong")),
  });

  const dirty = name.trim() !== org.name || currency !== org.currency;

  return (
    <View style={{ gap: space.md }}>
      <Title style={{ fontSize: 18 }}>{t("settings.business")}</Title>

      <View style={{ gap: space.sm }}>
        <Label>{t("workspace.name")}</Label>
        <Input value={name} onChangeText={setName} editable={org.can_edit} autoCapitalize="words" />
      </View>

      <View style={{ gap: space.sm }}>
        <Label>{t("workspace.currency")}</Label>
        <Picker
          label={t("workspace.currency")}
          value={currency}
          onChange={setCurrency}
          options={CURRENCIES.map((x) => ({ value: x.code, label: `${x.code} · ${x.label}` }))}
        />
        <Body subtle style={{ fontSize: 12 }}>{t("workspace.currencyHint")}</Body>
      </View>

      {error ? <Body style={{ color: c.dangerStrong, fontSize: 13 }}>{error}</Body> : null}

      {/* Only an owner may rename the business the others work in. */}
      {org.can_edit ? (
        <Button
          title={t("action.save")}
          onPress={() => save.mutate()}
          busy={save.isPending}
          disabled={!dirty || !name.trim()}
        />
      ) : (
        <Body muted style={{ fontSize: 13 }}>{t("settings.ownerOnly")}</Body>
      )}
    </View>
  );
}

/** Who is in the business, and what each of them may do. */
function Members({ canEdit }: { canEdit: boolean }) {
  const c = useTheme();
  const qc = useQueryClient();
  const members = useQuery({
    queryKey: ["settings", "members"],
    queryFn: () => get<{ data: Member[] }>("settings/members"),
  });
  const roles = useQuery({
    queryKey: ["settings", "roles"],
    queryFn: () => get<{ data: Role[] }>("settings/roles"),
  });

  const setRole = useMutation({
    mutationFn: ({ id, role_id }: { id: string; role_id: string }) =>
      patch(`settings/members/${id}`, { role_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "members"] }),
    onError: (e) => Alert.alert(e instanceof ApiError ? e.message : t("record.somethingWrong")),
  });

  if (members.isPending) return <Loading />;
  const rows = members.data?.data ?? [];

  return (
    <View style={{ gap: space.md }}>
      <Title style={{ fontSize: 18 }}>{t("settings.members")}</Title>
      <Card>
        {rows.map((m, i) => (
          <View
            key={m.membership_id}
            style={{
              gap: space.sm,
              paddingHorizontal: space.lg,
              paddingVertical: space.md,
              borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: c.border,
            }}
          >
            <View>
              <Body style={{ fontWeight: "600" }}>{m.name}</Body>
              <Body muted style={{ fontSize: 12 }}>{m.email}</Body>
            </View>

            {/* An owner's access is not a role and cannot be taken away by
                changing one, so there is nothing to pick. */}
            {m.is_owner ? (
              <Body subtle style={{ fontSize: 12 }}>{t("value.owner")}</Body>
            ) : canEdit && roles.data ? (
              <Picker
                label={t("invite.role")}
                value={m.role_id ?? ""}
                onChange={(role_id) => setRole.mutate({ id: m.membership_id, role_id })}
                options={(roles.data.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
              />
            ) : (
              <Body subtle style={{ fontSize: 12 }}>{m.role_name ?? ""}</Body>
            )}
          </View>
        ))}
      </Card>
    </View>
  );
}

/**
 * Inviting somebody.
 *
 * There is no mail server, so an invitation is a link the owner passes on
 * themselves. The token is shown exactly once — the row keeps only its digest
 * — so this hands it straight to the share sheet rather than printing it in a
 * list to be copied later, because later it is gone.
 */
function Invitations() {
  const c = useTheme();
  const qc = useQueryClient();
  const [email, setEmail] = React.useState("");
  const [roleId, setRoleId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const roles = useQuery({
    queryKey: ["settings", "roles"],
    queryFn: () => get<{ data: Role[] }>("settings/roles"),
  });
  const list = useQuery({
    queryKey: ["settings", "invitations"],
    queryFn: () => get<{ data: Invitation[] }>("settings/invitations"),
  });

  const create = useMutation({
    mutationFn: () => post<{ path: string }>("settings/invitations", { email: email.trim(), role_id: roleId }),
    onSuccess: async (res) => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["settings", "invitations"] });
      const link = `${API_BASE}${res.path}`;
      await Share.share({ message: link }).catch(() => undefined);
    },
    onError: (e) => setError(e instanceof ApiError ? (e.fields[0]?.message ?? e.message) : t("invite.createFailed")),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => del(`settings/invitations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "invitations"] }),
  });

  const options = (roles.data?.data ?? []).map((r) => ({ value: r.id, label: r.name }));
  const outstanding = list.data?.data ?? [];

  return (
    <View style={{ gap: space.md }}>
      <Title style={{ fontSize: 18 }}>{t("invite.someone")}</Title>
      <Body muted style={{ fontSize: 13 }}>{t("invite.handItOver")}</Body>

      <View style={{ gap: space.sm }}>
        <Label>{t("invite.email")}</Label>
        <Input
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            setError(null);
          }}
          placeholder={t("invite.emailPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          inputMode="email"
          keyboardType="email-address"
        />
      </View>

      <View style={{ gap: space.sm }}>
        <Label>{t("invite.role")}</Label>
        <Picker
          label={t("invite.role")}
          value={roleId}
          onChange={setRoleId}
          options={[{ value: "", label: t("invite.rolePlaceholder") }, ...options]}
        />
      </View>

      {error ? <Body style={{ color: c.dangerStrong, fontSize: 13 }}>{error}</Body> : null}

      <Button
        title={t("invite.createLink")}
        onPress={() => create.mutate()}
        busy={create.isPending}
        disabled={!email.trim() || !roleId}
      />

      {outstanding.length ? (
        <Card>
          {outstanding.map((inv, i) => (
            <View
              key={inv.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                minHeight: 56,
                borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: c.border,
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Body numberOfLines={1}>{inv.email}</Body>
                <Body subtle style={{ fontSize: 12 }}>
                  {[inv.role_name, t("invite.expires", undefined, { date: formatDate(inv.expires_at) })]
                    .filter(Boolean)
                    .join(" · ")}
                </Body>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("invite.revoke")}
                onPress={() => revoke.mutate(inv.id)}
                style={({ pressed }) => ({ padding: space.sm, opacity: pressed ? 0.6 : 1 })}
              >
                <Trash2 size={16} color={c.mutedForeground} />
              </Pressable>
            </View>
          ))}
        </Card>
      ) : (
        <Empty title={t("invite.noneOutstanding")} />
      )}
    </View>
  );
}

/** What this screen deliberately does not carry, and where it lives instead. */
function ElsewhereNote() {
  const c = useTheme();
  return (
    <View
      style={{
        borderRadius: radius,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        padding: space.lg,
        gap: space.xs,
      }}
    >
      <Body style={{ fontWeight: "600" }}>{t("settings.onTheWeb")}</Body>
      <Body muted style={{ fontSize: 13 }}>{t("settings.onTheWebWhy")}</Body>
    </View>
  );
}
