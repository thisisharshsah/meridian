import { useColorScheme } from "react-native";

/**
 * The web's design tokens, in hex.
 *
 * Converted from the OKLCH values in `apps/web/src/app/globals.css` rather than
 * picked by eye, so the two clients are the same product in the same colours.
 * React Native cannot parse `oklch()`, which is the only reason these are
 * duplicated at all. The badge tones keep the contrast the web measured for
 * them: 6:1 or better on light, and no worse than 4.8:1 on dark.
 */
export const palettes = {
  light: {
    background: "#fdfdfe",
    foreground: "#15181e",
    surface: "#ffffff",
    surfaceMuted: "#f5f7f9",
    border: "#e1e3e6",
    borderStrong: "#ced1d6",
    mutedForeground: "#686c73",
    subtleForeground: "#888c93",
    brand: "#2068cb",
    brandHover: "#0555b7",
    brandForeground: "#fbfcfd",
    brandSubtle: "#e7f1ff",
    brandSubtleForeground: "#06489c",
    success: "#0e9254",
    successSubtle: "#daf7e3",
    successStrong: "#006533",
    warning: "#d48e00",
    warningSubtle: "#fff0c5",
    warningStrong: "#784a00",
    danger: "#d02c2e",
    dangerSubtle: "#ffe5e1",
    dangerStrong: "#ac0216",
    info: "#008bc2",
    infoSubtle: "#d9f3ff",
    infoStrong: "#005d8d",
    purple: "#8851d1",
    purpleSubtle: "#f2e9ff",
  },
  dark: {
    background: "#0c0f14",
    foreground: "#eceff2",
    surface: "#14171d",
    surfaceMuted: "#1b1e24",
    border: "#282c31",
    borderStrong: "#393d45",
    mutedForeground: "#9a9fa6",
    subtleForeground: "#767b82",
    brand: "#4f91f2",
    brandHover: "#66a5ff",
    brandForeground: "#080d16",
    brandSubtle: "#172944",
    brandSubtleForeground: "#a3c9ff",
    success: "#3bb974",
    successSubtle: "#11331f",
    successStrong: "#3bb974",
    warning: "#e8ab3e",
    warningSubtle: "#3e2d10",
    warningStrong: "#e8ab3e",
    danger: "#f3625b",
    dangerSubtle: "#47211e",
    dangerStrong: "#fa6961",
    info: "#4cb0e5",
    infoSubtle: "#0d2f41",
    infoStrong: "#4cb0e5",
    purple: "#ae84f2",
    purpleSubtle: "#332647",
  },
} as const;

/**
 * The names a screen may reach for. Widened from the literal hex values the
 * table above carries, or the dark palette would be a different type from the
 * light one and nothing could accept both.
 */
export type Palette = { readonly [K in keyof (typeof palettes)["light"]]: string };

/** Follows the phone's own light/dark setting, like the web follows the browser's. */
export function useTheme(): Palette {
  return palettes[useColorScheme() === "dark" ? "dark" : "light"];
}

/** The tone names the API sends with a select option, mapped to a pair of colours. */
export function toneColors(tone: string | undefined, c: Palette) {
  switch (tone) {
    case "success": return { bg: c.successSubtle, fg: c.successStrong };
    case "warning": return { bg: c.warningSubtle, fg: c.warningStrong };
    case "danger": return { bg: c.dangerSubtle, fg: c.dangerStrong };
    case "info": return { bg: c.infoSubtle, fg: c.infoStrong };
    case "purple": return { bg: c.purpleSubtle, fg: c.purple };
    case "brand": return { bg: c.brandSubtle, fg: c.brandSubtleForeground };
    default: return { bg: c.surfaceMuted, fg: c.mutedForeground };
  }
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = 10;
