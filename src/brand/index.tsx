import { useEffect } from "react";
import { View, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { G, Path, Rect } from "react-native-svg";
import { color } from "../theme";
import { ICON_SMALL_TRANSFORM, ICON_TRANSFORM, ICON_VIEWBOX, WORDMARK_PATH, WORDMARK_VIEWBOX } from "./paths";

const [, , VB_W, VB_H] = WORDMARK_VIEWBOX.split(" ").map(Number);

/**
 * The wali wordmark, from brand kit v2. The name is the mark: there is no symbol or monogram, and the
 * word is outlined artwork, never retyped in a font. Always lowercase, always one line. One flat colour
 * (ink on paper, paper on night, cream on photos; never ember), at least 44pt wide like the web app's.
 */
export function Wordmark({ width = 76, fill = color.ink }: { width?: number; fill?: string }) {
  const w = Math.max(44, width);
  return (
    <Svg width={w} height={(w * VB_H) / VB_W} viewBox={WORDMARK_VIEWBOX} accessibilityLabel="wali" accessibilityRole="image">
      <Path d={WORDMARK_PATH} fill={fill} />
    </Svg>
  );
}

/**
 * The app icon: the whole word on an ink tile, used as wali's avatar. Under 40pt it uses the kit's
 * small-size artwork, where the word is widened to fill more of the square.
 */
export function WaliMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox={ICON_VIEWBOX} accessibilityElementsHidden importantForAccessibility="no">
      <Rect width={64} height={64} rx={64 * 0.22} fill={color.ink} />
      <G transform={size < 40 ? ICON_SMALL_TRANSFORM : ICON_TRANSFORM}>
        <Path d={WORDMARK_PATH} fill={color.paper} />
      </G>
    </Svg>
  );
}

/** The single accent: something happening now (the pendant is listening). */
export function EmberDot({ live = true, size = 8, style }: { live?: boolean; size?: number; style?: ViewStyle }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (!live) return;
    t.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.bezier(0.22, 1, 0.36, 1) }), -1, true);
  }, [live, t]);
  const anim = useAnimatedStyle(() => ({ opacity: 1 - t.value * 0.55, transform: [{ scale: 1 - t.value * 0.18 }] }));
  const base = { width: size, height: size, borderRadius: size / 2 };
  if (!live) return <View style={[base, { backgroundColor: "rgba(154,149,139,0.5)" }, style]} />;
  return <Animated.View style={[base, { backgroundColor: color.ember }, anim, style]} />;
}
