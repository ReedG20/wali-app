import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Text } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { convex } from "../lib/convex";
import { color } from "../theme";

void SplashScreen.preventAutoHideAsync();

const CLERK_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout() {
  // The pendant pipeline is started by index.ts (src/lib/boot.ts) when the bundle loads, before and
  // without any UI, whether or not anyone is signed in: audio is saved first, always.
  if (!CLERK_KEY) {
    void SplashScreen.hideAsync();
    return <Text style={{ padding: 60 }}>Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in .env.local</Text>;
  }

  return (
    <ClerkProvider publishableKey={CLERK_KEY} tokenCache={tokenCache}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <KeyboardProvider>
          <StatusBar style="dark" />
          <Routes />
        </KeyboardProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

function Routes() {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (isLoaded) void SplashScreen.hideAsync();
  }, [isLoaded]);
  if (!isLoaded) return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.paper } }}>
      <Stack.Protected guard={!!isSignedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
