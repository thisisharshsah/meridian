import * as React from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { Stack, useRouter } from "expo-router";

import { Body, Button, Choice, Input, Label, Picker, Title } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSessionState } from "@/lib/session";
import { space, useTheme } from "@/lib/theme";
import { CURRENCIES } from "@suite/shared/constants";
import { t } from "@suite/shared/i18n";

type Intent = "starting" | "invited";

/**
 * Creating an account, asking the same question the web asks first: are you
 * starting a business or joining one? Starting means owning a business from
 * this moment, so it needs a name and a currency; joining means an account and
 * nothing else, ready for the invitation waiting on that address.
 */
export default function SignUp() {
  const c = useTheme();
  const router = useRouter();
  const { signUp } = useSessionState();

  const [intent, setIntent] = React.useState<Intent>("starting");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [organization, setOrganization] = React.useState("");
  const [currency, setCurrency] = React.useState("USD");
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const starting = intent === "starting";

  const submit = async () => {
    if (busy) return;
    // Checked here as well as on the server, so a missing business name is
    // answered without a round trip.
    const local: Record<string, string> = {};
    if (!name.trim()) local.name = t("auth.nameRequired");
    if (!email.includes("@")) local.email = t("auth.emailInvalid");
    if (password.length < 8) local.password = t("auth.passwordShort");
    if (starting && !organization.trim()) local.organization = t("auth.nameTheBusiness");
    setErrors(local);
    if (Object.keys(local).length) return;

    setBusy(true);
    setFormError(null);
    try {
      await signUp({
        name,
        email,
        password,
        ...(starting ? { organization: organization.trim(), currency } : {}),
      });
      router.replace("/");
    } catch (e) {
      if (e instanceof ApiError && e.fields.length) setErrors(e.fieldMap);
      else setFormError(e instanceof Error ? e.message : t("record.somethingWrong"));
      setBusy(false);
    }
  };

  const Error_ = ({ field }: { field: string }) =>
    errors[field] ? <Body style={{ color: c.dangerStrong, fontSize: 13 }}>{errors[field]}</Body> : null;

  return (
    <>
      <Stack.Screen options={{ title: t("auth.createAccount") }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: space.xs }}>
            <Title>{t("auth.createAccount")}</Title>
            <Body muted>{starting ? t("auth.ownerNote") : t("auth.invitedNote")}</Body>
          </View>

          <View style={{ gap: space.sm }}>
            <Label>{t("auth.intent")}</Label>
            <Choice<Intent>
              value={intent}
              onChange={setIntent}
              options={[
                { value: "starting", label: t("auth.startingLabel"), hint: t("auth.startingHint") },
                { value: "invited", label: t("auth.invitedLabel"), hint: t("auth.invitedHint") },
              ]}
            />
          </View>

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
            <Error_ field="name" />
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
              textContentType="username"
            />
            <Error_ field="email" />
          </View>

          <View style={{ gap: space.sm }}>
            <Label>{t("auth.choosePassword")}</Label>
            <Input
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoComplete="new-password"
              secureTextEntry
              textContentType="newPassword"
            />
            <Body subtle style={{ fontSize: 12 }}>{t("auth.passwordHint")}</Body>
            <Error_ field="password" />
          </View>

          {starting ? (
            <>
              <View style={{ gap: space.sm }}>
                <Label>{t("auth.businessName")}</Label>
                <Input
                  value={organization}
                  onChangeText={setOrganization}
                  placeholder={t("auth.businessPlaceholder")}
                  autoCapitalize="words"
                />
                <Error_ field="organization" />
              </View>

              <View style={{ gap: space.sm }}>
                <Label>{t("auth.currency")}</Label>
                <Picker
                  label={t("auth.currency")}
                  value={currency}
                  onChange={setCurrency}
                  options={CURRENCIES.map((x) => ({ value: x.code, label: `${x.code} · ${x.label}` }))}
                />
                <Body subtle style={{ fontSize: 12 }}>{t("workspace.currencyHint")}</Body>
              </View>
            </>
          ) : null}

          {formError ? <Body style={{ color: c.dangerStrong }}>{formError}</Body> : null}

          <Button title={t("auth.createAccount")} onPress={submit} busy={busy} />

          <Pressable accessibilityRole="button" onPress={() => router.replace("/sign-in")} style={{ minHeight: 44, justifyContent: "center" }}>
            <Body style={{ color: c.brand, textAlign: "center" }}>{t("auth.haveAccount")}</Body>
          </Pressable>

          <View style={{ height: space.xl }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
