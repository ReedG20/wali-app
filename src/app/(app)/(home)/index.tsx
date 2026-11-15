import { useQuery } from "convex/react";
import { Stack } from "expo-router";
import { Text, View } from "react-native";
import { EmberDot, Wordmark } from "../../../brand";
import { ChatView } from "../../../chat/ChatView";
import { api } from "../../../lib/convex-api";
import type { Thread } from "../../../lib/types";
import { useListening } from "../../../lib/useListening";
import { useNewChat } from "../../../lib/useNewChat";
import { color, type } from "../../../theme";
import { Spinner } from "../../../ui";

/** The home thread: where wali's nudges arrive and where you can always just talk. */
export default function Home() {
  const home = useQuery(api.threads.home) as Thread | null | undefined;
  const listening = useListening();
  const newChat = useNewChat();

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={{ alignItems: "center" }}>
              <Wordmark width={56} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
                <EmberDot live={listening} size={6} />
                <Text style={[type.meta, { fontSize: 11.5 }]}>{listening ? "Listening" : "Pendant idle"}</Text>
              </View>
            </View>
          ),
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="square.and.pencil" accessibilityLabel="New chat" onPress={newChat} />
      </Stack.Toolbar>
      {home ? (
        <ChatView threadId={home._id} />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.paper }}>
          <Spinner />
        </View>
      )}
    </>
  );
}
