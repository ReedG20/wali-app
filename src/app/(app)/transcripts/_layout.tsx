import { Stack } from "expo-router";
import { stackOptions } from "../../../navigation";

export default function TabStack() {
  return (
    <Stack screenOptions={stackOptions}>
      {/* A title from the start: until the screen sets its own, the header showed the route name "[id]". */}
      <Stack.Screen name="[id]" options={{ title: "Transcript", headerLargeTitle: false }} />
    </Stack>
  );
}
