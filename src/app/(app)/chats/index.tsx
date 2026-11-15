import { useMutation, useQuery } from "convex/react";
import { Link, Stack } from "expo-router";
import { useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { errorText } from "../../../chat/Cards";
import { api } from "../../../lib/convex-api";
import { ago } from "../../../lib/time";
import type { Thread } from "../../../lib/types";
import { useNewChat } from "../../../lib/useNewChat";
import { largeTitle } from "../../../navigation";
import { color, font, type } from "../../../theme";
import { Card, Icon, Lede, Loading, Pill } from "../../../ui";

/** Every conversation you started with wali. Long-press for a native preview and menu. */
export default function Chats() {
  const threads = useQuery(api.threads.list) as Thread[] | undefined;
  const remove = useMutation(api.threads.remove);
  const rename = useMutation(api.threads.rename);
  const newChat = useNewChat();
  const [query, setQuery] = useState("");
  const chats = (threads ?? [])
    .filter((t) => t.kind === "chat")
    .filter((t) => !query || `${t.title} ${t.preview ?? ""}`.toLowerCase().includes(query.toLowerCase()));

  function confirmDelete(t: Thread) {
    Alert.alert("Delete this chat?", `“${t.title}” and its messages will be removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void remove({ id: t._id }).catch((e) => Alert.alert("Couldn't delete that chat", errorText(e, "Try again."))),
      },
    ]);
  }

  function promptRename(t: Thread) {
    Alert.prompt(
      "Rename chat",
      undefined,
      (title) => title?.trim() && void rename({ id: t._id, title: title.trim() }).catch((e) => Alert.alert("Couldn't rename", errorText(e, "Try again."))),
      "plain-text",
      t.title,
    );
  }

  return (
    <>
      <Stack.Screen options={{ ...largeTitle, title: "Chats" }} />
      <Stack.SearchBar placeholder="Search chats" onChangeText={(e) => setQuery(e.nativeEvent.text)} hideWhenScrolling />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="square.and.pencil" accessibilityLabel="New chat" onPress={newChat} />
      </Stack.Toolbar>
      <FlatList
        data={chats}
        keyExtractor={(t) => t._id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        style={{ backgroundColor: color.paper }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        ListHeaderComponent={<Lede>Ask anything about your day, or hand wali something to do.</Lede>}
        ListEmptyComponent={
          threads === undefined ? (
            <Loading fill={false} />
          ) : (
            <Card style={{ alignItems: "flex-start", gap: 14 }}>
              <Text style={[type.secondary, { fontSize: 14.5 }]}>
                {query ? "No chats match that." : "No chats yet. Your wali thread is always on the first tab."}
              </Text>
              {!query ? <Pill title="New chat" icon="plus" size="sm" onPress={newChat} /> : null}
            </Card>
          )
        }
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item: t }) => (
          <Link href={{ pathname: "/(app)/chats/[id]", params: { id: t._id } }} asChild>
            <Link.Trigger>
              <Pressable>
                <View style={s.row}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.title} numberOfLines={2}>
                    {t.title}
                  </Text>
                  {t.preview ? (
                    <Text style={[type.meta, { fontSize: 14, marginTop: 3 }]} numberOfLines={2}>
                      {t.preview}
                    </Text>
                  ) : null}
                </View>
                <Text style={[type.meta, { fontSize: 12 }]}>{ago(t.updatedAt)}</Text>
                <Icon name="chevron.right" size={12} tint={color.ink3} />
                </View>
              </Pressable>
            </Link.Trigger>
            <Link.Preview />
            <Link.Menu>
              <Link.MenuAction title="Rename" icon="pencil" onPress={() => promptRename(t)} />
              <Link.MenuAction title="Delete chat" icon="trash" destructive onPress={() => confirmDelete(t)} />
            </Link.Menu>
          </Link>
        )}
      />
    </>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: color.card,
    borderRadius: 20,
    borderCurve: "continuous",
    paddingHorizontal: 16,
    paddingVertical: 14,
    boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 14px 30px -26px rgba(0,0,0,0.35)",
  },
  title: { fontFamily: font.medium, fontSize: 16, color: color.ink },
});
