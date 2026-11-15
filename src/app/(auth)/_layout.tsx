import { Stack } from "expo-router";
import { color, font } from "../../theme";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerTransparent: true,
        headerTitle: "",
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        headerTintColor: color.ink,
        headerTitleStyle: { fontFamily: font.medium },
        contentStyle: { backgroundColor: color.paper },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
