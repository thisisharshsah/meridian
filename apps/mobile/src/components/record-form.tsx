import * as React from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";

import { ChipSelect, SuggestChips } from "@/components/field-chips";
import { RefPicker } from "@/components/ref-picker";
import { Body, Button, Input, Label, Picker } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useCreate, useUpdate, type Record_ } from "@/lib/queries";
import { radius, space, useTheme } from "@/lib/theme";
import { optionsOf, type EntityMeta, type FieldDef } from "@suite/shared/meta";
import { formatDate, formatDateTime, moneyToInput, percentToInput, qtyToInput } from "@suite/shared/format";
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
  fixed,
  onSaved,
  onCancel,
}: {
  meta: EntityMeta;
  record?: Record_ | null;
  /**
   * Decided by where the form was opened rather than by the person filling it
   * in — a line knows which document it belongs to. Seeded into the payload
   * and not offered as a field, because there is nothing to choose.
   */
  fixed?: Record<string, unknown>;
  onSaved: (saved: Record_) => void;
  onCancel: () => void;
}) {
  const c = useTheme();
  const editing = !!record?.id;
  const create = useCreate(meta.key);
  const update = useUpdate(meta.key);

  // Totals, balances, stock levels and document numbers are the server's to
  // decide; it discards them on write, so asking for them would be a lie.
  const editable = React.useMemo(
    () => meta.fields.filter((f) => !f.readonly && !(fixed && f.name in fixed)),
    [meta.fields, fixed],
  );

  const [values, setValues] = React.useState<Record<string, unknown>>(() => {
    const seed: Record<string, unknown> = {};
    for (const f of editable) {
      if (record) {
        seed[f.name] = record[f.name] ?? null;
        continue;
      }
      // The column's own default first — it is what the server would have
      // written anyway. Failing that, a required choice starts on its first
      // option rather than on nothing: a new deal is at the first stage and a
      // new invoice is a draft, and making somebody tap to say so is asking a
      // question whose answer is already known.
      const fallback =
        f.required && f.kind.type === "select" ? (optionsOf(f)[0]?.value ?? null) : null;
      seed[f.name] = f.default ?? fallback;
    }
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
    const payload: Record<string, unknown> = { ...fixed };
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
            <FieldInput
              field={f}
              entity={meta.key}
              value={values[f.name]}
              onChange={(v) => setValue(f.name, v)}
            />
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
 * The line past which a list of options stops being chips.
 *
 * Seven, as on the web: thirty-three of the schema's thirty-five selects have
 * five or fewer, and past seven the chips wrap into a block nobody can read.
 */
const CHIP_LIMIT = 7;

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
  entity,
  value,
  onChange,
}: {
  field: FieldDef;
  entity: string;
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
      if (options.length <= CHIP_LIMIT) {
        return (
          <ChipSelect
            options={options}
            value={(value as string) ?? null}
            onChange={onChange}
            clearable={!field.required}
          />
        );
      }
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

    case "date":
    case "date_time":
      return (
        <DateField
          value={(value as string) ?? null}
          onChange={onChange}
          withTime={field.kind.type === "date_time"}
        />
      );

    default:
      if (field.suggest && entity) {
        return (
          <View style={{ gap: space.sm }}>
            <Input value={(value as string) ?? ""} onChangeText={onChange} />
            <SuggestChips
              entity={entity}
              field={field.name}
              value={(value as string) ?? ""}
              onChange={onChange}
            />
          </View>
        );
      }
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

/**
 * A date, chosen rather than typed.
 *
 * It was a text box wanting `2026-09-16`, which asks a person to know the
 * server's format and to type it without a slip. The platform has a date
 * picker and everyone already knows how to use it.
 *
 * A date-only field is built from the parts the wheel shows, not from
 * `toISOString()`: the latter converts to UTC first, so an evening in
 * Kathmandu is filed as the following morning — or the previous one, west of
 * Greenwich. A moment in time is a different thing and does go as UTC, which
 * is what a timestamp means.
 */
function DateField({
  value,
  onChange,
  withTime,
}: {
  value: string | null;
  onChange: (v: string) => void;
  withTime: boolean;
}) {
  const c = useTheme();
  const [open, setOpen] = React.useState(false);
  const parsed = value ? new Date(value.length === 10 ? `${value}T00:00:00` : value) : null;
  const shown = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();

  const commit = (d: Date) => {
    onChange(withTime ? d.toISOString() : localDate(d));
    if (Platform.OS !== "ios") setOpen(false);
  };

  const picker = (
    <DateTimePicker
      value={shown}
      mode={withTime ? "datetime" : "date"}
      display={Platform.OS === "ios" ? "inline" : "default"}
      onChange={(_, d) => {
        if (d) commit(d);
        else setOpen(false);
      }}
    />
  );

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          minHeight: 48,
          justifyContent: "center",
          paddingHorizontal: space.md,
          borderRadius: radius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          backgroundColor: pressed ? c.surfaceMuted : c.surface,
        })}
      >
        <Text style={{ color: value ? c.foreground : c.subtleForeground, fontSize: 16 }}>
          {value ? (withTime ? formatDateTime(value) : formatDate(value)) : t("record.select")}
        </Text>
      </Pressable>

      {open && Platform.OS === "ios" ? (
        <Modal visible animationType="slide" transparent onRequestClose={() => setOpen(false)}>
          <Pressable style={{ flex: 1, backgroundColor: "#0006" }} onPress={() => setOpen(false)} />
          <View
            style={{
              backgroundColor: c.surface,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              padding: space.lg,
              gap: space.md,
            }}
          >
            {picker}
            <Button title={t("invite.done")} onPress={() => setOpen(false)} />
          </View>
        </Modal>
      ) : null}

      {open && Platform.OS !== "ios" ? picker : null}
    </>
  );
}

/** The day the wheel is showing, in the server's shape, without a timezone hop. */
function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
