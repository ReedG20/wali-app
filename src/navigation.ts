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
};

export const largeTitle: NativeStackNavigationOptions = { headerLargeTitle: true };
