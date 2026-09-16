import * as React from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { Body, Button, Input, Label, Logo, Title } from "@/components/ui";
import { ApiError, get } from "@/lib/api";
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

  /**
   * What this installation is sold as. The one endpoint that needs no
   * credentials, because this screen has no session to read a name from — and
   * a customer on Aurovie Rooms should not be greeted by another product's
   * name. A slow or failed answer falls back rather than holding the screen.
   */
  const product = useQuery({
    queryKey: ["product"],
    queryFn: () => get<{ product?: string }>("health"),
    staleTime: Infinity,
    retry: false,
  });

  if (status === "signedIn") return <Redirect href="/" />;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      router.replace("/");
    } catch (e) {
      // The API says "Incorrect email or password" against the password field,
      // deliberately the same answer for an unknown address, so an outsider
      // cannot use this screen to learn who has an account.
      const message =
        e instanceof ApiError
          ? (e.fields[0]?.message ?? e.message)
          : t("record.somethingWrong");
      setError(message);
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space.xl, gap: space.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: "center", gap: space.md }}>
          <Logo size={44} />
          <Title>{product.data?.product || t("app.name")}</Title>
          <Body muted style={{ textAlign: "center" }}>{t("auth.welcome")}</Body>
        </View>

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

        <View style={{ gap: space.xs, alignItems: "center" }}>
          <Body muted style={{ fontSize: 13 }}>{t("auth.firstTime")}</Body>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/sign-up")}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Body style={{ color: c.brand }}>{t("auth.createAccount")}</Body>
          </Pressable>
          {/* Someone handed a link rather than an account: the way in that
              needs no password of their own yet. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/invite")}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Body style={{ color: c.brand }}>{t("mobile.openInvite")}</Body>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
