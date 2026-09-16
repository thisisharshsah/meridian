import * as React from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { Stack, useRouter } from "expo-router";

import { RequireSession } from "@/components/guard";
import { Body, Button, Input, Label, Picker, Title } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSessionState } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { CURRENCIES, DEFAULT_CURRENCY } from "@suite/shared/constants";
import { t } from "@suite/shared/i18n";

export default function NewBusiness() {
  return (
    <RequireSession>
      <NewBusinessScreen />
    </RequireSession>
  );
}

/**
 * Another business under the same login. The account already exists, so this
 * only needs a name and what it charges in — roles, numbering and ownership
 * are set up by the server.
 */
function NewBusinessScreen() {
  const c = useTheme();
  const router = useRouter();
  const { createWorkspace } = useSessionState();
  const [name, setName] = React.useState("");
  const [currency, setCurrency] = React.useState(DEFAULT_CURRENCY);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (!name.trim()) {
      setError(t("workspace.nameRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createWorkspace(name.trim(), currency);
      // The reply is a session inside the new business, so home is now it.
      router.replace("/");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("workspace.failed"));
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: t("workspace.create") }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: space.xs }}>
            <Title>{t("workspace.create")}</Title>
            <Body muted>{t("workspace.createLede")}</Body>
          </View>

          <View style={{ gap: space.sm }}>
            <Label>{t("workspace.name")}</Label>
            <Input
              value={name}
              onChangeText={(v) => {
                setName(v);
                setError(null);
              }}
              placeholder={t("auth.businessPlaceholder")}
              autoCapitalize="words"
            />
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

          {error ? <Body style={{ color: c.dangerStrong }}>{error}</Body> : null}

          <Button title={t("workspace.create")} onPress={submit} busy={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
