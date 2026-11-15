// Small, brand-specific building blocks. Anything iOS already does well (headers, back buttons,
// tab bar, search, switches, pickers, menus, alerts) comes from the platform instead.
import * as Haptics from "expo-haptics";
import { SymbolView, type SFSymbol } from "expo-symbols";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { color, display, font, radius, softShadow, type } from "../theme";

export function Icon({ name, size = 18, tint = color.ink2 }: { name: SFSymbol; size?: number; tint?: string }) {
  return <SymbolView name={name} size={size} tintColor={tint} resizeMode="scaleAspectFit" style={{ width: size, height: size }} />;
}

type PillKind = "primary" | "secondary" | "cream" | "onPhoto";

const pillColors: Record<PillKind, { bg: string; fg: string }> = {
  primary: { bg: color.ink, fg: "#FFFFFF" },
  secondary: { bg: color.tint, fg: color.ink },
  cream: { bg: color.cream, fg: color.ink },
  onPhoto: { bg: "rgba(255,255,255,0.16)", fg: "#FFFFFF" },
};

/** Pill button (design brief: 36–52pt tall, ink primary, tinted secondary, no outlines). */
export function Pill({
  title,
  onPress,
  kind = "primary",
  size = "md",
  icon,
  busy,
  disabled,
  style,
}: {
  title: string;
  onPress?: () => void;
  kind?: PillKind;
  size?: "sm" | "md" | "lg";
  icon?: SFSymbol;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = pillColors[kind];
  const h = size === "sm" ? 34 : size === "md" ? 42 : 54;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.pill,
        { height: h, paddingHorizontal: size === "sm" ? 14 : 20, backgroundColor: c.bg },
        kind === "onPhoto" && styles.onPhoto,
        { opacity: disabled ? 0.4 : pressed ? 0.82 : 1, transform: [{ translateY: pressed ? 1 : 0 }] },
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={c.fg} /> : icon ? <Icon name={icon} size={size === "lg" ? 18 : 15} tint={c.fg} /> : null}
      <Text style={[styles.pillText, { color: c.fg, fontSize: size === "sm" ? 13.5 : size === "md" ? 15 : 16.5 }]}>{title}</Text>
    </Pressable>
  );
}

/** A white card: anything you read or interact with. */
export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  return <View style={[styles.card, padded && { padding: 18 }, style]}>{children}</View>;
}

/** A tappable row inside a card, with an optional trailing accessory. */
export function Row({
  title,
  subtitle,
  icon,
  onPress,
  trailing,
  chevron = !!onPress,
  first,
}: {
  title: string;
  subtitle?: string;
  icon?: SFSymbol;
  onPress?: () => void;
  trailing?: ReactNode;
  chevron?: boolean;
  first?: boolean;
}) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, !first && styles.rowLine, pressed && { backgroundColor: color.tint }]}
    >
      {icon ? (
        <View style={styles.rowIcon}>
          <Icon name={icon} size={17} tint={color.ink} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={type.label} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[type.meta, { marginTop: 1 }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {chevron ? <Icon name="chevron.right" size={13} tint={color.ink3} /> : null}
    </Pressable>
  );
}

/** Section heading in Fraunces with an optional quiet description. */
export function SectionHead({ title, description, aside }: { title: string; description?: string; aside?: ReactNode }) {
  return (
    <View style={styles.sectionHead}>
      <View style={{ flex: 1 }}>
        <Text style={display(24)}>{title}</Text>
        {description ? <Text style={[type.secondary, { marginTop: 4, fontSize: 14.5, lineHeight: 21 }]}>{description}</Text> : null}
      </View>
      {aside}
    </View>
  );
}

/** Lede under a native large title: one quiet sentence about the page. */
export function Lede({ children }: { children: ReactNode }) {
  return <Text style={[type.secondary, { marginBottom: 26, marginTop: 2 }]}>{children}</Text>;
}

/** Scrolling page on paper. Insets come from the native header and tab bar. */
export function Page({ children, contentStyle, ...rest }: ScrollViewProps & { contentStyle?: StyleProp<ViewStyle> }) {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      style={{ flex: 1, backgroundColor: color.paper }}
      contentContainerStyle={[{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 48 }, contentStyle]}
      {...rest}
    >
      {children}
    </ScrollView>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <Card>
      <Text style={[type.secondary, { fontSize: 14.5 }]}>{children}</Text>
    </Card>
  );
}

export function Skeleton({ height = 16, width = "100%", style }: { height?: number; width?: ViewStyle["width"]; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height, width, borderRadius: 999, backgroundColor: color.tint }, style]} />;
}

export function Spinner({ tint = color.ink3 }: { tint?: string }) {
  return <ActivityIndicator size="small" color={tint} />;
}

export const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: radius.pill, borderCurve: "continuous" },
  onPhoto: { borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.28)" },
  pillText: { fontFamily: font.medium, letterSpacing: -0.1 },
  card: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderCurve: "continuous",
    ...softShadow,
    outlineColor: "rgba(22,21,19,0.05)",
    outlineWidth: 1,
    outlineStyle: "solid",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, minHeight: 54 },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderCurve: "continuous",
    backgroundColor: color.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHead: { flexDirection: "row", alignItems: "flex-end", gap: 12, marginTop: 34, marginBottom: 12 },
});
