import { useMutation, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Alert, Text, View } from "react-native";
import { ChatView } from "../../../chat/ChatView";
import { api } from "../../../lib/convex-api";
import type { Thread } from "../../../lib/types";
import { noEdgeEffects } from "../../../navigation";
import { color, type } from "../../../theme";
import { friendlyError } from "../../../lib/errors";

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const threadId = id as Id<"threads">;
  const thread = useQuery(api.threads.get, { id: threadId }) as Thread | null | undefined;
  const remove = useMutation(api.threads.remove);
  const rename = useMutation(api.threads.rename);

  if (thread === null)
    return (
      <>
        <Stack.Screen options={{ title: "Chat", headerLargeTitle: false }} />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.paper }}>
          <Text style={type.secondary}>This chat doesn&apos;t exist anymore.</Text>
        </View>
      </>
    );

  return (
    <>
      <Stack.Screen options={{ ...noEdgeEffects, title: thread?.title ?? "Chat", headerLargeTitle: false }} />
      {thread?.kind === "chat" ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon="ellipsis">
            <Stack.Toolbar.MenuAction
              icon="pencil"
              onPress={() =>
                Alert.prompt(
                  "Rename chat",
                  undefined,
                  (t) => t?.trim() && void rename({ id: threadId, title: t.trim() }).catch((e) => Alert.alert("Couldn't rename", friendlyError(e, "Try again."))),
                  "plain-text",
                  thread.title,
                )
              }
            >
              Rename
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon="trash"
              destructive
              onPress={() =>
                Alert.alert("Delete this chat?", undefined, [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () => {
                      router.back();
                      remove({ id: threadId }).catch((e) => Alert.alert("Couldn't delete that chat", friendlyError(e, "Try again.")));
                    },
                  },
                ])
              }
            >
              Delete chat
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : null}
      <ChatView threadId={threadId} />
    </>
  );
}
