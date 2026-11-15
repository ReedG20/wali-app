import { Image } from "expo-image";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { clerkMessage, useGoogle } from "../../auth/flow";
import { Wordmark } from "../../brand";
import { color, display, font } from "../../theme";
import { Pill } from "../../ui";

/** First screen: the long-exposure meadow from the landing page, the line, and two ways in. */
export default function Welcome() {
  const insets = useSafeAreaInsets();
  const google = useGoogle();
  const [busy, setBusy] = useState(false);

  async function withGoogle() {
    setBusy(true);
    try {
      await google();
    } catch (e) {
      Alert.alert("Google sign-in didn't finish", clerkMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: color.night }}>
      <Image source={require("../../../assets/images/hero-meadow.jpg")} style={StyleSheet.absoluteFill} contentFit="cover" transition={400} />
      <View style={[StyleSheet.absoluteFill, s.shade]} />
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 24 }}>
        <Wordmark width={84} fill={color.cream} />
      </View>
      <View style={{ flex: 1 }} />
      <Animated.View entering={FadeInDown.duration(900).delay(150)} style={{ paddingHorizontal: 24 }}>
        <Text style={[display(48), { color: "#FFFFFF" }]}>
          A Fitbit for your mind. <Text style={[display(48, true), { color: "rgba(255,255,255,0.82)" }]}>Quietly listening.</Text>
        </Text>
        <Text style={s.lede}>wali notices who lifts you up, what wears you down, and what you said you&apos;d do.</Text>
      </Animated.View>
      <Animated.View entering={FadeInDown.duration(900).delay(300)} style={[s.actions, { paddingBottom: insets.bottom + 16 }]}>
        <Pill title="Continue with Google" kind="cream" size="lg" icon="g.circle.fill" busy={busy} onPress={withGoogle} />
        <Pill title="Continue with email" kind="onPhoto" size="lg" icon="envelope" onPress={() => router.push("/(auth)/email")} />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  shade: { experimental_backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0.7) 100%)" },
  lede: { fontFamily: font.body, fontSize: 17, lineHeight: 25, color: "rgba(255,255,255,0.78)", marginTop: 14, maxWidth: 340 },
  actions: { paddingHorizontal: 24, paddingTop: 28, gap: 10 },
});
