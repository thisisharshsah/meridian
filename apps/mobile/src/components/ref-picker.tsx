import * as React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Check, ChevronDown, X } from "lucide-react-native";

import { Body, Empty, Input, Loading, Title } from "@/components/ui";
import { useLookup } from "@/lib/queries";
import { radius, space, useTheme } from "@/lib/theme";
import { t } from "@suite/shared/i18n";

/**
 * Choosing another record: the customer an invoice belongs to, the account a
 * deal is against.
 *
 * The list comes from the server's lookup, which searches and labels each
 * record by whatever its entity calls its title — so this never learns that a
 * contact is named by `full_name` and an item by `name`. It searches rather
 * than loading everything, because a workspace with four thousand customers
 * cannot be a dropdown.
 */
export function RefPicker({
  entity,
  label,
  value,
  onChange,
}: {
  entity: string;
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const c = useTheme();
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [chosenLabel, setChosenLabel] = React.useState<string | null>(null);

  React.useEffect(() => {
    const id = setTimeout(() => setQuery(term), 250);
    return () => clearTimeout(id);
  }, [term]);

  const lookup = useLookup(open || value ? entity : undefined, query);
  const rows = lookup.data?.data ?? [];

  // The record arrives holding an id; its label comes from the same lookup the
  // picker uses, so an edit form shows a name rather than a UUID.
  const current = chosenLabel ?? rows.find((r) => r.id === value)?.label ?? null;

  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={() => setOpen(true)}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 48,
            justifyContent: "center",
            paddingHorizontal: space.md,
            borderRadius: radius,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            backgroundColor: pressed ? c.surfaceMuted : c.surface,
          })}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Text
              numberOfLines={1}
              style={{ flex: 1, color: value ? c.foreground : c.subtleForeground, fontSize: 16 }}
            >
              {value ? (current ?? "…") : t("record.select")}
            </Text>
            <ChevronDown size={15} color={c.subtleForeground} />
          </View>
        </Pressable>

        {value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("record.clearThing", undefined, { label })}
            onPress={() => {
              onChange(null);
              setChosenLabel(null);
            }}
            style={({ pressed }) => ({ padding: space.sm, opacity: pressed ? 0.6 : 1 })}
          >
            <X size={16} color={c.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "#0006" }} onPress={() => setOpen(false)} />
        <View
          style={{
            maxHeight: "75%",
            backgroundColor: c.surface,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            paddingTop: space.lg,
          }}
        >
          <Title style={{ fontSize: 17, paddingHorizontal: space.lg }}>{label}</Title>
          <View style={{ padding: space.md }}>
            <Input
              value={term}
              onChangeText={setTerm}
              placeholder={t("record.searchPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space.xl }}>
            {lookup.isPending ? <Loading /> : null}
            {!lookup.isPending && !rows.length ? (
              <Empty
                title={term ? t("record.nothingMatches", undefined, { term }) : t("record.noneYet", undefined, { label })}
              />
            ) : null}

            {rows.map((r) => {
              const on = r.id === value;
              return (
                <Pressable
                  key={r.id}
                  accessibilityRole="button"
                  onPress={() => {
                    onChange(r.id);
                    setChosenLabel(r.label);
                    setOpen(false);
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
                  <Body style={{ flex: 1, color: on ? c.brand : c.foreground }} numberOfLines={1}>
                    {r.label}
                  </Body>
                  {on ? <Check size={16} color={c.brand} /> : null}
                </Pressable>
              );
            })}

            {lookup.data && lookup.data.total > rows.length ? (
              <Body muted style={{ fontSize: 12, padding: space.lg }}>
                {t("record.lookupSubset", undefined, { n: rows.length, total: lookup.data.total })}
              </Body>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
