import * as React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Check, ChevronDown } from "lucide-react-native";

import { Title } from "@/components/ui";
import { radius, space, useTheme } from "@/lib/theme";
import { optionsOf, type FieldDef } from "@suite/shared/meta";
import { t } from "@suite/shared/i18n";

/**
 * The select fields of an entity, as chips that narrow the list.
 *
 * Which fields is the registry's answer, not a decision here: anything the
 * server describes as a select has a fixed set of values and is therefore
 * worth filtering by. Three of them, because a row of chips is a row, and the
 * fourth would push the first record further down the screen than it is worth.
 *
 * The field's name stays on the chip after a value is picked. As a placeholder
 * it would vanish at exactly the moment it starts to matter, leaving a lone
 * "Closed won" with nothing saying what it filtered — the web learned this
 * one already.
 */
export function FilterChips({
  fields,
  value,
  onChange,
}: {
  fields: FieldDef[];
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const c = useTheme();
  const [open, setOpen] = React.useState<FieldDef | null>(null);

  const selects = fields.filter((f) => f.kind.type === "select").slice(0, 3);
  if (!selects.length) return null;

  const options = open ? optionsOf(open) : [];
  const chosen = open ? value[open.name] : undefined;

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // A horizontal ScrollView stretches its children to its own height and
        // takes whatever vertical space the column has spare — which turned
        // three chips into three pills half a screen tall. It is as tall as a
        // chip, and the chips sit in the middle of it.
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{
          alignItems: "center",
          paddingHorizontal: space.md,
          gap: space.xs,
          paddingBottom: space.xs,
        }}
      >
        {selects.map((f) => {
          const picked = value[f.name];
          const label = picked ? (optionsOf(f).find((o) => o.value === picked)?.label ?? picked) : t("record.all");
          const on = !!picked;
          return (
            <Pressable
              key={f.name}
              accessibilityRole="button"
              accessibilityLabel={t("record.filterBy", undefined, { label: f.label })}
              onPress={() => setOpen(f)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space.xs,
                minHeight: 30,
                paddingHorizontal: space.sm + 2,
                borderRadius: 999,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: on ? c.brand : c.border,
                backgroundColor: pressed ? c.surfaceMuted : on ? c.brandSubtle : c.surface,
              })}
            >
              <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{f.label}:</Text>
              <Text style={{ color: on ? c.brandSubtleForeground : c.foreground, fontSize: 12, fontWeight: "600" }}>
                {label}
              </Text>
              <ChevronDown size={12} color={c.subtleForeground} />
            </Pressable>
          );
        })}
      </ScrollView>

      <Modal visible={!!open} animationType="slide" transparent onRequestClose={() => setOpen(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "#0006" }} onPress={() => setOpen(null)} />
        <View
          style={{
            maxHeight: "60%",
            backgroundColor: c.surface,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            paddingTop: space.lg,
          }}
        >
          <Title style={{ fontSize: 17, paddingHorizontal: space.lg, paddingBottom: space.sm }}>
            {open?.label ?? ""}
          </Title>
          <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
            {[{ value: "", label: t("record.all") }, ...options].map((o) => {
              const on = (chosen ?? "") === o.value;
              return (
                <Pressable
                  key={o.value || "__all"}
                  accessibilityRole="button"
                  onPress={() => {
                    if (!open) return;
                    const next = { ...value };
                    if (o.value) next[open.name] = o.value;
                    else delete next[open.name];
                    onChange(next);
                    setOpen(null);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                    minHeight: 52,
                    paddingHorizontal: space.lg,
                    backgroundColor: pressed ? c.surfaceMuted : "transparent",
                  })}
                >
                  <Text style={{ flex: 1, color: on ? c.brand : c.foreground, fontSize: 16 }}>{o.label}</Text>
                  {on ? <Check size={16} color={c.brand} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
