import { Stack } from "expo-router";
import { noEdgeEffects, stackOptions } from "../../../navigation";

export default function TabStack() {
  return (
    <Stack screenOptions={stackOptions}>
      {/* A title from the start: until the thread loads, the header would show the route name "[id]". */}
      <Stack.Screen name="[id]" options={{ ...noEdgeEffects, title: "Chat", headerLargeTitle: false }} />
    </Stack>
  );
}
