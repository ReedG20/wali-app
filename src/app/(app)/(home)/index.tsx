import { useQuery } from "convex/react";
import { Stack } from "expo-router";
import { Text, View } from "react-native";
import { EmberDot, Wordmark } from "../../../brand";
import { ChatView } from "../../../chat/ChatView";
import { useConnectionStatus } from "../../../lib/connection";
import { api } from "../../../lib/convex-api";
import type { Thread } from "../../../lib/types";
import { useListening } from "../../../lib/useListening";
import { useNewChat } from "../../../lib/useNewChat";
import { noEdgeEffects } from "../../../navigation";
import { type } from "../../../theme";
import { Loading } from "../../../ui";

/** The home thread: where wali's nudges arrive and where you can always just talk. */
export default function Home() {
  const home = useQuery(api.threads.home) as Thread | null | undefined;
  const listening = useListening();
  const connection = useConnectionStatus();
  const newChat = useNewChat();
  // The pendant can be listening while the app can't reach the server; say the thing that explains
  // why a message isn't going through.
  const status = connection === "offline" ? "Offline" : connection === "reconnecting" ? "Reconnecting…" : listening ? "Listening" : "Pendant idle";

  return (
    <>
      <Stack.Screen
        options={{
          ...noEdgeEffects,
          headerTitle: () => (
            <View style={{ alignItems: "center" }}>
              <Wordmark width={56} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
                <EmberDot live={listening && connection === "ok"} size={6} />
                <Text style={[type.meta, { fontSize: 11.5 }]}>{status}</Text>
              </View>
            </View>
          ),
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="square.and.pencil" accessibilityLabel="New chat" onPress={newChat} />
      </Stack.Toolbar>
      {home ? <ChatView threadId={home._id} /> : <Loading />}
    </>
  );
}
