import type { NativeStackNavigationOptions } from "expo-router/native-stack";
import { color, font } from "./theme";

/**
 * Native iOS headers everywhere (Liquid Glass bar, system back button and swipe-back), with
 * large titles set in Fraunces so they read as wali rather than as Settings.app.
 */
export const stackOptions: NativeStackNavigationOptions = {
  headerTransparent: true,
  headerShadowVisible: false,
  headerLargeTitleShadowVisible: false,
  headerBackButtonDisplayMode: "minimal",
  headerTintColor: color.ink,
  headerTitleStyle: { fontFamily: font.semibold, fontSize: 17, color: color.ink },
  headerLargeTitleStyle: { fontFamily: "WaliDisplay", fontSize: 38, color: color.ink },
  contentStyle: { backgroundColor: color.paper },
  // iOS 26: the default ("automatic") edge effect is so soft that scrolled text stayed readable
  // right through the title, the back button and the status bar. "hard" gives the bar a proper
  // backing with a cutoff line. The tab bar edge keeps the system default.
  scrollEdgeEffects: { top: "hard" },
};

/**
 * Chat screens use an inverted list and draw their own fade under the header (ChatView), so the
 * system edge effects are off there: on a flipped scroll view they can land on the wrong edge.
 */
export const noEdgeEffects: NativeStackNavigationOptions = {
  scrollEdgeEffects: { top: "hidden", bottom: "hidden", left: "hidden", right: "hidden" },
};

export const largeTitle: NativeStackNavigationOptions = { headerLargeTitle: true };
