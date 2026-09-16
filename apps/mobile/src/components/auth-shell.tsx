import * as React from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";

import { Body, Logo, Title } from "@/components/ui";
import { get } from "@/lib/api";
import { radius, space, useTheme } from "@/lib/theme";
import { t } from "@suite/shared/i18n";

/**
 * The shell every way in shares, and the web's own: a brand-tinted ground with
 * a dotted texture, the mark and the product's name, then a card.
 *
 * `brandSubtle` is a pale tint in light and a deep one in dark, so one rule
 * gives a branded field in both themes rather than a bright slab in the dark.
 */
export function AuthShell({
  title,
  lede,
  children,
  footer,
}: {
  title: string;
  lede?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const c = useTheme();

  /**
   * What this installation is sold as. The one endpoint that needs no
   * credentials, because these screens have no session to read a name from.
   */
  const product = useQuery({
    queryKey: ["product"],
    queryFn: () => get<{ product?: string }>("health"),
    staleTime: Infinity,
    retry: false,
  });

  return (
    <View style={{ flex: 1, backgroundColor: c.brandSubtle }}>
      <Dots color={c.brand} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ alignItems: "center", gap: space.sm, marginBottom: space.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Logo size={32} />
              <Title style={{ color: c.brandSubtleForeground, fontSize: 19 }}>
                {product.data?.product || t("app.name")}
              </Title>
            </View>
            <Body style={{ color: c.brandSubtleForeground, opacity: 0.8, fontSize: 13, textAlign: "center" }}>
              {t("auth.pitch")}
            </Body>
          </View>

          <View
            style={{
              backgroundColor: c.surface,
              borderColor: c.border,
              borderWidth: StyleSheet.hairlineWidth,
              borderRadius: radius + 4,
              padding: space.lg,
              gap: space.lg,
            }}
          >
            <View style={{ gap: space.xs }}>
              <Title>{title}</Title>
              {lede ? <Body muted>{lede}</Body> : null}
            </View>
            {children}
          </View>

          {footer ? <View style={{ marginTop: space.lg, alignItems: "center" }}>{footer}</View> : null}

          <Body style={{ color: c.brandSubtleForeground, opacity: 0.7, fontSize: 11, textAlign: "center", marginTop: space.lg }}>
            {t("auth.selfHosted")}
          </Body>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** The web's 22px dot grid, drawn once as a tiled SVG pattern. */
function Dots({ color }: { color: string }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" opacity={0.12}>
      <Defs>
        <Pattern id="dots" width={22} height={22} patternUnits="userSpaceOnUse">
          <Circle cx={1} cy={1} r={1} fill={color} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#dots)" />
    </Svg>
  );
}
