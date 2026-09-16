import * as React from "react";
import { Pressable, View } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";

import { AuthShell } from "@/components/auth-shell";
import { Body, Button, Input, Label } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSessionState } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { t } from "@suite/shared/i18n";

export default function SignIn() {
  const c = useTheme();
  const router = useRouter();
  const { status, signIn } = useSessionState();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (status === "signedIn") return <Redirect href="/" />;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      router.replace("/");
    } catch (e) {
      // The API answers "Incorrect email or password" against the password
      // field, and says the same for an address that has no account at all, so
      // this screen cannot be used to find out who is registered.
      const message = e instanceof ApiError ? (e.fields[0]?.message ?? e.message) : t("record.somethingWrong");
      setError(message);
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <AuthShell title={t("auth.signIn")} lede={t("auth.welcome")}>
        <View style={{ gap: space.sm }}>
          <Label>{t("auth.email")}</Label>
          <Input
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            inputMode="email"
            keyboardType="email-address"
            returnKeyType="next"
            textContentType="username"
          />
        </View>

        <View style={{ gap: space.sm }}>
          <Label>{t("auth.password")}</Label>
          <Input
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            autoComplete="current-password"
            secureTextEntry
            returnKeyType="go"
            textContentType="password"
            onSubmitEditing={submit}
          />
        </View>

        {error ? <Body style={{ color: c.dangerStrong }}>{error}</Body> : null}

        <Button title={t("auth.signIn")} onPress={submit} busy={busy} disabled={!email || !password} />

        {/* A copy of this can open with no accounts in it at all, so the way
            out of this screen matters as much as the way through it. */}
        <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: space.lg, gap: space.sm }}>
          <Body muted style={{ textAlign: "center", fontSize: 13 }}>{t("auth.firstTime")}</Body>
          <Button title={t("auth.startBusiness")} variant="quiet" onPress={() => router.push("/sign-up")} />
          {/* Tapping an invitation link opens the website until this app is
              signed by an Apple account, so pasting one is the way in. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/invite")}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Body style={{ color: c.brand, textAlign: "center", fontSize: 13 }}>{t("mobile.openInvite")}</Body>
          </Pressable>
        </View>
      </AuthShell>
    </>
  );
}
