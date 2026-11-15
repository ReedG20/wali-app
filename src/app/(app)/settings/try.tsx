import { useAction } from "convex/react";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { errorText } from "../../../chat/Cards";
import { api } from "../../../lib/convex-api";
import { color, font, type } from "../../../theme";
import { Card, Lede, Page, Pill } from "../../../ui";

const SAMPLE = `Speaker 1: I keep saying I'll call my mom back and then it's Friday again.
Speaker 2: You should just do it tonight after dinner.
Speaker 1: Yeah. Remind me, honestly. Also I told Sam I'd send him the deck by tomorrow morning and I haven't touched it.
Speaker 2: That's a lot for one night.
Speaker 1: I'm kind of wiped. I've been on my phone since like four.`;

/** Paste a conversation and run it through the same pipeline a pendant recording takes. */
export default function TryIt() {
  const simulate = useAction(api.agentNode.simulate);
  const checkNow = useAction(api.agentNode.checkNow);
  const [sample, setSample] = useState(SAMPLE);
  const [running, setRunning] = useState<"sim" | "check" | null>(null);

  async function run(kind: "sim" | "check") {
    setRunning(kind);
    try {
      if (kind === "sim") await simulate({ transcript: sample });
      else await checkNow({});
      Alert.alert("wali looked it over", "Anything it decided to say is in your wali thread. Activity shows how it decided.", [
        { text: "See activity", onPress: () => router.replace("/(app)/settings/activity") },
        { text: "OK", style: "cancel" },
      ]);
    } catch (e) {
      Alert.alert("That didn't run", errorText(e, "Try again."));
    } finally {
      setRunning(null);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Try it without the pendant", headerLargeTitle: false }} />
      <Page>
        <Lede>Run a conversation through wali exactly as if the pendant had heard it. No pendant needed.</Lede>
        <Card style={{ padding: 10 }}>
          <TextInput
            value={sample}
            onChangeText={setSample}
            multiline
            scrollEnabled={false}
            selectionColor={color.ember}
            style={s.input}
            accessibilityLabel="Conversation transcript"
          />
        </Card>
        <Text style={[type.meta, { marginTop: 12 }]}>
          This is the real thing, not a preview: wali may message you, save notes to memory, set follow-ups or ask to act in your apps, just as it would after a real conversation.
        </Text>
        <View style={{ gap: 10, marginTop: 16 }}>
          <Pill title="Run through wali" size="lg" busy={running === "sim"} disabled={!!running || !sample.trim()} onPress={() => run("sim")} />
          <Pill title="Check the last two hours" size="lg" kind="secondary" busy={running === "check"} disabled={!!running} onPress={() => run("check")} />
        </View>
      </Page>
    </>
  );
}

const s = StyleSheet.create({
  input: { minHeight: 200, padding: 10, fontFamily: font.body, fontSize: 15, lineHeight: 22, color: color.ink, textAlignVertical: "top" },
});
