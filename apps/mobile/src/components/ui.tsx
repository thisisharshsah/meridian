import * as React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  View,
  type ViewProps,
} from "react-native";

import Svg, { Path, Rect } from "react-native-svg";

import { radius, space, useTheme } from "@/lib/theme";
import { t } from "@suite/shared/i18n";

/** Body text in the theme's foreground. Nothing renders bare `<Text>`. */
export function Body({ style, muted, subtle, ...rest }: TextProps & { muted?: boolean; subtle?: boolean }) {
  const c = useTheme();
  const color = subtle ? c.subtleForeground : muted ? c.mutedForeground : c.foreground;
  return <Text {...rest} style={[{ color, fontSize: 15 }, style]} />;
}

export function Title({ style, ...rest }: TextProps) {
  const c = useTheme();
  return <Text {...rest} style={[{ color: c.foreground, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 }, style]} />;
}

export function Label({ style, ...rest }: TextProps) {
  const c = useTheme();
  return <Text {...rest} style={[{ color: c.mutedForeground, fontSize: 12, fontWeight: "600" }, style]} />;
}

export function Card({ style, ...rest }: ViewProps) {
  const c = useTheme();
  return (
    <View
      {...rest}
      style={[
        { backgroundColor: c.surface, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius },
        style,
      ]}
    />
  );
}

export function Button({
  title,
  onPress,
  busy,
  variant = "primary",
  disabled,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  variant?: "primary" | "quiet";
  disabled?: boolean;
}) {
  const c = useTheme();
  const primary = variant === "primary";
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: primary ? (pressed ? c.brandHover : c.brand) : pressed ? c.surfaceMuted : "transparent",
        borderColor: primary ? "transparent" : c.border,
        borderWidth: primary ? 0 : StyleSheet.hairlineWidth,
        borderRadius: radius,
        // 48pt: a finger, not a cursor.
        minHeight: 48,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: space.lg,
        opacity: off ? 0.6 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={primary ? c.brandForeground : c.brand} />
      ) : (
        <Text style={{ color: primary ? c.brandForeground : c.foreground, fontSize: 16, fontWeight: "600" }}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Input({ style, ...rest }: TextInputProps) {
  const c = useTheme();
  return (
    <TextInput
      placeholderTextColor={c.subtleForeground}
      {...rest}
      style={[
        {
          backgroundColor: c.surface,
          borderColor: c.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius,
          color: c.foreground,
          fontSize: 16,
          minHeight: 48,
          paddingHorizontal: space.md,
        },
        style,
      ]}
    />
  );
}

/**
 * Two ways in, side by side, each with a line saying what it means. The web
 * asks the same question on its sign-up page: what someone is here to do
 * decides what the form asks for next, so it is asked first rather than
 * inferred from which fields they filled in.
 */
export function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; hint: string }[];
  onChange: (v: T) => void;
}) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              minHeight: 64,
              justifyContent: "center",
              gap: 2,
              padding: space.md,
              borderRadius: radius,
              borderWidth: on ? 2 : StyleSheet.hairlineWidth,
              borderColor: on ? c.brand : c.border,
              backgroundColor: on ? c.brandSubtle : c.surface,
            }}
          >
            <Text style={{ color: on ? c.brandSubtleForeground : c.foreground, fontSize: 14, fontWeight: "600" }}>
              {o.label}
            </Text>
            <Text style={{ color: on ? c.brandSubtleForeground : c.mutedForeground, fontSize: 12 }}>{o.hint}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * One of a list, chosen in a sheet. A phone has no room for a dropdown beside
 * a field, and the OS picker is better at a long list than anything drawn here.
 */
export function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const c = useTheme();
  const [open, setOpen] = React.useState(false);
  const chosen = options.find((o) => o.value === value);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        style={{
          minHeight: 48,
          justifyContent: "center",
          paddingHorizontal: space.md,
          borderRadius: radius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          backgroundColor: c.surface,
        }}
      >
        <Text style={{ color: c.foreground, fontSize: 16 }}>{chosen?.label ?? value}</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "#0006" }} onPress={() => setOpen(false)} />
        <View style={{ maxHeight: "60%", backgroundColor: c.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
          <ScrollView contentContainerStyle={{ paddingVertical: space.sm }}>
            {options.map((o) => (
              <Pressable
                key={o.value}
                accessibilityRole="button"
                onPress={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={({ pressed }) => ({
                  minHeight: 52,
                  justifyContent: "center",
                  paddingHorizontal: space.lg,
                  backgroundColor: pressed ? c.surfaceMuted : "transparent",
                })}
              >
                <Text style={{ color: o.value === value ? c.brand : c.foreground, fontSize: 16 }}>{o.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

export function Badge({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: space.sm, paddingVertical: 2, alignSelf: "flex-start" }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

export function Loading() {
  const c = useTheme();
  return (
    <View style={{ padding: space.xl, alignItems: "center" }}>
      <ActivityIndicator color={c.mutedForeground} />
    </View>
  );
}

/**
 * Something went wrong, said in a sentence and with a way out. The API's own
 * message is shown when it has one: it is written for the person reading it.
 */
export function Problem({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error && error.message ? error.message : t("record.somethingWrong");
  return (
    <View style={{ padding: space.lg, gap: space.md }}>
      <Body muted>{message}</Body>
      {onRetry ? <Button title={t("action.tryAgain")} variant="quiet" onPress={onRetry} /> : null}
    </View>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <View style={{ padding: space.xl, gap: space.xs, alignItems: "center" }}>
      <Body style={{ fontWeight: "600" }}>{title}</Body>
      {body ? <Body muted style={{ textAlign: "center" }}>{body}</Body> : null}
    </View>
  );
}

/**
 * The web's mark, same viewBox and same path: four quadrants for the four
 * sides of a business — sell, bill, deliver, support.
 */
export function Logo({ size = 32 }: { size?: number }) {
  const c = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Rect width={32} height={32} rx={8} fill={c.brand} />
      <Path
        d="M8.5 21.5V10.5L16 17.5L23.5 10.5V21.5"
        stroke={c.brandForeground}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
