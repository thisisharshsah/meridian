import * as React from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { AuthShell } from "@/components/auth-shell";
import { Body, Button, Input, Label, Loading } from "@/components/ui";
import { ApiError, acceptInvitation, previewInvitation } from "@/lib/api";
import { useSessionState } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { t } from "@suite/shared/i18n";

/**
 * Accepting an invitation, from the link itself.
 *
 * The link is the credential, so this shows only what the invitee already
 * knows — their own address and the business's name — until they authenticate.
 * An address that already has an account is asked for that account's password:
 * an invitation admits someone to a workspace, it is never a way into a login.
 */
export default function Invite() {
  const c = useTheme();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { signIn } = useSessionState();

  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => previewInvitation(token),
    retry: false,
  });

  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  if (preview.isPending) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AuthShell title={t("invite.waiting")}>
          <Loading />
        </AuthShell>
      </>
    );
  }

  if (preview.error || !preview.data) {
    const message = preview.error instanceof ApiError ? preview.error.message : t("auth.linkInvalid");
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <AuthShell title={t("auth.inviteUnavailable")} lede={message}>
          <Body subtle style={{ fontSize: 13 }}>{t("auth.linkStale")}</Body>
          <Button title={t("auth.goToSignIn")} variant="quiet" onPress={() => router.replace("/sign-in")} />
        </AuthShell>
      </>
    );
  }

  const invite = preview.data;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      await acceptInvitation(token, { name: name.trim() || undefined, password });
      // Accepting creates the membership but no session, so this signs in with
      // the same credentials — the invitee lands inside the business rather
      // than on a sign-in form they have just proved they can pass.
      await signIn(invite.email, password);
      router.replace("/");
    } catch (e) {
      if (e instanceof ApiError && e.fields.length) setErrors(e.fieldMap);
      else setFormError(e instanceof Error ? e.message : t("invite.failed"));
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <AuthShell
        title={t("invite.join", undefined, { name: invite.organization })}
        lede={t("auth.invitedAs", undefined, { role: invite.role_name })}
      >
        <Body subtle style={{ fontSize: 13 }}>{invite.email}</Body>

        {invite.has_account ? (
          <Body muted>{t("auth.haveAccountAlready")}</Body>
        ) : (
          <View style={{ gap: space.sm }}>
            <Label>{t("auth.yourName")}</Label>
            <Input
              value={name}
              onChangeText={setName}
              placeholder={t("auth.namePlaceholder")}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
            />
            {errors.name ? <Body style={{ color: c.dangerStrong, fontSize: 13 }}>{errors.name}</Body> : null}
          </View>
        )}

        <View style={{ gap: space.sm }}>
          <Label>{invite.has_account ? t("auth.yourPassword") : t("auth.choosePassword")}</Label>
          <Input
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            autoComplete={invite.has_account ? "current-password" : "new-password"}
            secureTextEntry
            textContentType={invite.has_account ? "password" : "newPassword"}
            onSubmitEditing={submit}
          />
          {invite.has_account ? null : <Body subtle style={{ fontSize: 12 }}>{t("auth.passwordHint")}</Body>}
          {errors.password ? <Body style={{ color: c.dangerStrong, fontSize: 13 }}>{errors.password}</Body> : null}
        </View>

        {formError ? <Body style={{ color: c.dangerStrong }}>{formError}</Body> : null}

        <Button title={t("choose.accept")} onPress={submit} busy={busy} disabled={!password} />
      </AuthShell>
    </>
  );
}
