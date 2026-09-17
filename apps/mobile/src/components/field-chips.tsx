import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Body } from "@/components/ui";
import { useStats } from "@/lib/queries";
import { radius, space, toneColors, useTheme } from "@/lib/theme";
import type { SelectOption } from "@suite/shared/meta";
import { t } from "@suite/shared/i18n";

/**
 * A short list of options, as chips.
 *
 * Every choice is visible and costs one tap, instead of a sheet sliding over
 * the form to show five words. The web draws the line at seven options —
 * thirty-three of the schema's thirty-five selects have five or fewer — and
 * past that chips wrap into an unreadable block and a picker is the better
 * control. Same number here, so a field looks the same on both.
 */
export function ChipSelect({
  options,
  value,
  onChange,
  clearable,
}: {
  options: SelectOption[];
  value: string | null;
  onChange: (v: string | null) => void;
  /** An optional field can be put back to nothing by tapping what is chosen. */
  clearable?: boolean;
}) {
  const c = useTheme();

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
      {options.map((o) => {
        const on = o.value === value;
        const tone = toneColors(o.tone, c);
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(on && clearable ? null : o.value)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              minHeight: 38,
              paddingHorizontal: space.md,
              borderRadius: radius,
              borderWidth: on ? 2 : StyleSheet.hairlineWidth,
              borderColor: on ? c.brand : c.border,
              backgroundColor: pressed ? c.surfaceMuted : on ? c.brandSubtle : c.surface,
            })}
          >
            {/* The option's own tone, as a dot beside the word rather than as
                the colour of the word: red and green sit too close together
                for a colour-blind reader to tell apart on their own. */}
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tone.fg }} />
            <Text
              style={{
                color: on ? c.brandSubtleForeground : c.foreground,
                fontSize: 14,
                fontWeight: on ? "700" : "500",
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * What this workspace already calls things.
 *
 * Free text is how one category becomes "Hardware", "hardware" and "HW" —
 * three buckets for one thing and a report that quietly undercounts all three.
 * The values come from the stats endpoint's `group_by`, which already returns
 * the distinct ones for any field, scoped to the business and gated on the
 * same view permission, so this needs no new endpoint and can never offer a
 * value the person is not allowed to see. Typing something new still works;
 * the chips are an offer, not a list of what is permitted.
 */
export function SuggestChips({
  entity,
  field,
  value,
  onChange,
}: {
  entity: string;
  field: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const c = useTheme();
  const stats = useStats(entity, { group_by: field });

  const options = React.useMemo(() => {
    const seen = new Set<string>();
    for (const row of stats.data?.data ?? []) {
      if (typeof row.bucket === "string" && row.bucket.trim()) seen.add(row.bucket);
    }
    // Six: enough to cover what a business actually uses, few enough to stay
    // one line of chips beside a keyboard.
    return [...seen].sort((a, b) => a.localeCompare(b)).slice(0, 6);
  }, [stats.data]);

  if (!options.length) return null;

  return (
    <View style={{ gap: space.xs }}>
      <Body subtle style={{ fontSize: 11 }}>{t("record.inUse")}</Body>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
        {options.map((o) => {
          const on = o === value;
          return (
            <Pressable
              key={o}
              accessibilityRole="button"
              onPress={() => onChange(on ? "" : o)}
              style={({ pressed }) => ({
                minHeight: 32,
                justifyContent: "center",
                paddingHorizontal: space.md,
                borderRadius: 999,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: on ? c.brand : c.border,
                backgroundColor: pressed ? c.surfaceMuted : on ? c.brandSubtle : c.surface,
              })}
            >
              <Text
                style={{ color: on ? c.brandSubtleForeground : c.mutedForeground, fontSize: 13, fontWeight: on ? "700" : "500" }}
                numberOfLines={1}
              >
                {o}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
