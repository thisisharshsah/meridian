import * as React from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { Stack, useRouter } from "expo-router";

import { Body, Button, Input, Label, Title } from "@/components/ui";
import { space, useTheme } from "@/lib/theme";
import { t } from "@suite/shared/i18n";

/**
 * A way in for an invitation link that arrived somewhere the phone cannot hand
 * to the app — a message, an email read on a laptop, a link typed out.
 *
 * Tapping such a link opens the website, not this app: that needs Apple's
 * associated-domains file, which needs a developer account this build does not
 * have yet. Pasting it works today and keeps working afterwards.
 */
export default function OpenInvite() {
  const c = useTheme();
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const open = () => {
    // Whatever they paste, the token is the last path segment; a bare code is
    // the whole of it. Query strings and trailing slashes are dropped.
    const raw = text.trim().split(/[?#]/)[0].replace(/\/+$/, "");
    const token = raw.split("/").pop() ?? "";
    if (!token || /\s/.test(token)) {
      setError(t("mobile.inviteUnreadable"));
      return;
    }
    router.push(`/invite/${encodeURIComponent(token)}`);
  };

  return (
    <>
      <Stack.Screen options={{ title: t("mobile.openInvite") }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: space.xs }}>
            <Title>{t("mobile.openInvite")}</Title>
            <Body muted>{t("mobile.openInviteWhy")}</Body>
          </View>

          <View style={{ gap: space.sm }}>
            <Label>{t("mobile.inviteLink")}</Label>
            <Input
              value={text}
              onChangeText={(v) => {
                setText(v);
                setError(null);
              }}
              placeholder={t("mobile.invitePlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="url"
              onSubmitEditing={open}
            />
            {error ? <Body style={{ color: c.dangerStrong, fontSize: 13 }}>{error}</Body> : null}
          </View>

          <Button title={t("action.continue")} onPress={open} disabled={!text.trim()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
