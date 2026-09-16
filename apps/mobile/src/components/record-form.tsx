import * as React from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Switch, View } from "react-native";

import { RefPicker } from "@/components/ref-picker";
import { Body, Button, Input, Label, Picker } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useCreate, useUpdate, type Record_ } from "@/lib/queries";
import { space, useTheme } from "@/lib/theme";
import { optionsOf, type EntityMeta, type FieldDef } from "@suite/shared/meta";
import { moneyToInput, percentToInput, qtyToInput } from "@suite/shared/format";
import { t } from "@suite/shared/i18n";

/**
 * Create and edit, generated from the entity's own description.
 *
 * Nothing here knows what a deal or an invoice is: the fields, their kinds,
 * which are required and which the server owns are all metadata, so a module
 * added to the registry is editable on the phone without a line written here.
 *
 * Validation is the server's. It returns errors keyed by field name, which
 * land under the right input — so the rules the form shows and the rules the
 * database keeps cannot disagree.
 */
export function RecordForm({
  meta,
  record,
  onSaved,
  onCancel,
}: {
  meta: EntityMeta;
  record?: Record_ | null;
  onSaved: (saved: Record_) => void;
  onCancel: () => void;
}) {
  const c = useTheme();
  const editing = !!record?.id;
  const create = useCreate(meta.key);
  const update = useUpdate(meta.key);

  // Totals, balances, stock levels and document numbers are the server's to
  // decide; it discards them on write, so asking for them would be a lie.
  const editable = React.useMemo(() => meta.fields.filter((f) => !f.readonly), [meta.fields]);

  const [values, setValues] = React.useState<Record<string, unknown>>(() => {
    const seed: Record<string, unknown> = {};
    for (const f of editable) seed[f.name] = record ? (record[f.name] ?? null) : (f.default ?? null);
    return seed;
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const setValue = (name: string, v: unknown) => {
    setValues((s) => ({ ...s, [name]: v }));
    setErrors((e) => (e[name] ? { ...e, [name]: "" } : e));
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErrors({});
    setFormError(null);

    // Only what was actually filled in, so an untouched optional field falls
    // back to the column's default rather than being written as null.
    const payload: Record<string, unknown> = {};
    for (const f of editable) {
      const v = values[f.name];
      if (editing) payload[f.name] = v;
      else if (v !== null && v !== undefined && v !== "") payload[f.name] = v;
    }

    try {
      const saved = editing
        ? await update.mutateAsync({ id: record!.id, body: payload })
        : await create.mutateAsync(payload);
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError && e.fields.length) setErrors(e.fieldMap);
      else setFormError(e instanceof Error ? e.message : t("record.somethingWrong"));
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
        {editable.map((f) => (
          <View key={f.name} style={{ gap: space.sm }}>
            <Label>
              {f.label}
              {f.required ? " *" : ""}
            </Label>
            <FieldInput field={f} value={values[f.name]} onChange={(v) => setValue(f.name, v)} />
            {f.help ? <Body subtle style={{ fontSize: 12 }}>{f.help}</Body> : null}
            {errors[f.name] ? (
              <Body style={{ color: c.dangerStrong, fontSize: 13 }}>{errors[f.name]}</Body>
            ) : null}
          </View>
        ))}

        {formError ? <Body style={{ color: c.dangerStrong }}>{formError}</Body> : null}

        <View style={{ gap: space.sm }}>
          <Button title={t("action.save")} onPress={submit} busy={busy} />
          <Button title={t("action.cancel")} variant="quiet" onPress={onCancel} disabled={busy} />
        </View>

        <View style={{ height: space.xl }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * One field, as the control its kind deserves.
 *
 * Money, quantities and percentages are scaled integers on the wire and typed
 * as decimals by a person, so they are held as text while being edited and
 * sent as text — the server parses and rejects "1.005" into a money field
 * rather than silently truncating it, and it is the only thing that should
 * decide that.
 */
function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const c = useTheme();

  switch (field.kind.type) {
    case "bool":
      return (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Switch
            value={!!value}
            onValueChange={onChange}
            trackColor={{ true: c.brand, false: c.borderStrong }}
          />
          <Body muted>{value ? t("value.yes") : t("value.no")}</Body>
        </View>
      );

    case "select": {
      const options = optionsOf(field);
      return (
        <Picker
          label={field.label}
          value={(value as string) ?? ""}
          onChange={onChange}
          options={[
            ...(field.required ? [] : [{ value: "", label: t("record.select") }]),
            ...options.map((o) => ({ value: o.value, label: o.label })),
          ]}
        />
      );
    }

    case "ref":
      return (
        <RefPicker
          entity={field.kind.entity}
          label={field.label}
          value={(value as string) ?? null}
          onChange={onChange}
        />
      );

    case "long_text":
      return (
        <Input
          value={(value as string) ?? ""}
          onChangeText={onChange}
          multiline
          numberOfLines={4}
          style={{ minHeight: 96, paddingTop: space.sm, textAlignVertical: "top" }}
        />
      );

    case "money":
    case "percent":
    case "quantity":
    case "int":
      return (
        <Input
          value={numberText(field, value)}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          inputMode="decimal"
        />
      );

    case "email":
      return (
        <Input
          value={(value as string) ?? ""}
          onChangeText={onChange}
          autoCapitalize="none"
          autoCorrect={false}
          inputMode="email"
          keyboardType="email-address"
        />
      );

    case "phone":
      return <Input value={(value as string) ?? ""} onChangeText={onChange} keyboardType="phone-pad" />;

    case "url":
      return (
        <Input
          value={(value as string) ?? ""}
          onChangeText={onChange}
          autoCapitalize="none"
          autoCorrect={false}
          inputMode="url"
        />
      );

    // No date picker yet: the shape a date has to arrive in is the one the
    // server reads, and typing it is honest about that until there is one.
    case "date":
      return (
        <Input
          value={(value as string) ?? ""}
          onChangeText={onChange}
          placeholder="2026-09-16"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
        />
      );

    default:
      return <Input value={(value as string) ?? ""} onChangeText={onChange} />;
  }
}

/** A scaled integer from the server, as the decimal a person types. */
function numberText(field: FieldDef, value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  const n = value as number;
  switch (field.kind.type) {
    case "money": return moneyToInput(n);
    case "percent": return percentToInput(n);
    case "quantity": return qtyToInput(n);
    default: return String(n);
  }
}
