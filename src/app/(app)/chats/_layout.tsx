import { Stack } from "expo-router";
import { stackOptions } from "../../../navigation";

export default function TabStack() {
  return <Stack screenOptions={stackOptions} />;
}
