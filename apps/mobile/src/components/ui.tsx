import * as React from "react";
import {
  ActivityIndicator,
  Pressable,
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
