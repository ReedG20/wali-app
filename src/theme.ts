// wali design tokens, shared with the landing page and web app (web/DESIGN-BRIEF.md).
import { StyleSheet, type TextStyle } from "react-native";

export const color = {
  paper: "#F6F4EF",
  paper2: "#ECE9E2",
  card: "#FFFFFF",
  ink: "#161513",
  ink2: "#5A564E",
  ink3: "#9A958B",
  line: "rgba(22,21,19,0.09)",
  tint: "rgba(22,21,19,0.06)",
  tintStrong: "rgba(22,21,19,0.1)",
  night: "#12110F",
  cream: "#FBF7EE",
  ember: "#D27A33",
  bubble: "#E9E5DC",
  onInk: "#FAF8F4",
} as const;

/**
 * Fonts are static instances cut from the variable files (assets/fonts, see scripts/instance-fonts.py):
 * Fraunces at SOFT 100 / WONK 0 / weight 340, and Figtree at 400, 500, 600. On iOS the family is the
 * PostScript name, so weights are separate families rather than fontWeight.
 */
export const font = {
  display: "WaliDisplay",
  displayItalic: "WaliDisplay-Italic",
  body: "WaliText-Regular",
  medium: "WaliText-Medium",
  semibold: "WaliText-SemiBold",
} as const;

export const radius = { card: 22, panel: 28, input: 26, pill: 999 } as const;

/** Display type: tracking -0.03em, tight leading. */
export function display(size: number, italic = false): TextStyle {
  return {
    fontFamily: italic ? font.displayItalic : font.display,
    fontSize: size,
    lineHeight: Math.round(size * 1.06),
    letterSpacing: -0.03 * size,
    color: color.ink,
  };
}

export const type = StyleSheet.create({
  body: { fontFamily: font.body, fontSize: 16, lineHeight: 24, color: color.ink },
  bodySm: { fontFamily: font.body, fontSize: 14.5, lineHeight: 21, color: color.ink },
  secondary: { fontFamily: font.body, fontSize: 15, lineHeight: 22, color: color.ink2 },
  meta: { fontFamily: font.body, fontSize: 13, lineHeight: 18, color: color.ink3 },
  label: { fontFamily: font.medium, fontSize: 15, color: color.ink },
});

/** Soft, diffuse depth only (design brief: never hard or coloured shadows). */
export const softShadow = {
  boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 18px 40px -28px rgba(0,0,0,0.35)",
} as const;
