import { useMutation, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { useFocusEffect } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useCallback, useMemo } from "react";
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { FadeInDown, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WaliMark } from "../brand";
import { api } from "../lib/convex-api";
import { setActiveThread } from "../lib/notifications";
import type { Message } from "../lib/types";
import { color, display, font, type } from "../theme";
import { Markdown } from "../ui/Markdown";
import { Spinner } from "../ui";
import { ApprovalCard, errorText, NudgeCard, UpdateRow } from "./Cards";
import { Composer } from "./Composer";
import { ToolCall } from "./ToolCall";

const SUGGESTIONS = [
  "What did I promise people today?",
  "Who did I talk to this afternoon?",
  "What's on my calendar tomorrow?",
  "Remind me to call Mom after my 3pm",
];

const enter = FadeInDown.duration(500).springify().damping(22);

/**
 * A wali thread. Messages stream in live from Convex; the composer floats on Liquid Glass above
 * the tab bar and rides the keyboard.
 */
export function ChatView({ threadId }: { threadId: Id<"threads"> }) {
  // While this thread is on screen, its own notifications stay quiet.
  useFocusEffect(
    useCallback(() => {
      setActiveThread(threadId);
      return () => setActiveThread(null);
    }, [threadId]),
  );
  const messages = useQuery(api.messages.list, { threadId }) as Message[] | undefined;
  const send = useMutation(api.messages.send);
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const kb = useReanimatedKeyboardAnimation();
  const busy = !!messages?.some((m) => m.status === "streaming");

  // Bottom space is the tab bar (safe-area inset) when the keyboard is down, the keyboard when up.
  const bottom = useAnimatedStyle(() => ({ paddingBottom: Math.max(insets.bottom, -kb.height.value) + 8 }));

  const onSend = useCallback(
    async (text: string) => {
      try {
        await send({ threadId, text });
      } catch (e) {
        Alert.alert("Couldn't send", errorText(e, "Try again."));
      }
    },
    [send, threadId],
  );

  const data = useMemo(() => (messages ? [...messages].reverse() : []), [messages]);
  const empty = messages && messages.length === 0;

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: color.paper }, bottom]}>
      {empty ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="interactive"
          contentContainerStyle={s.empty}
        >
          <Animated.View entering={enter}>
            <Text style={[display(40), { textAlign: "center" }]}>
              What&apos;s on <Text style={[display(40, true), { color: color.ink2 }]}>your mind?</Text>
            </Text>
            <Text style={[type.secondary, { textAlign: "center", marginTop: 12 }]}>
              Ask about your day, or ask wali to do something.
            </Text>
            <View style={s.suggestions}>
              {SUGGESTIONS.map((q) => (
                <Pressable key={q} onPress={() => onSend(q)} style={({ pressed }) => [s.suggestion, pressed && { backgroundColor: color.tintStrong }]}>
                  <Text style={s.suggestionText}>{q}</Text>
                </Pressable>
              ))}
            </View>
          </Animated.View>
        </ScrollView>
      ) : (
        <FlatList
          inverted
          data={data}
          keyExtractor={(m) => m._id}
          renderItem={({ item }) => <MessageRow m={item} />}
          // Inverted lists flip the automatic header inset to the bottom, so pad by hand
          // (paddingBottom is the visual top here).
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustsScrollIndicatorInsets={false}
          scrollIndicatorInsets={{ bottom: headerHeight }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: headerHeight + 16, gap: 22 }}
          ListEmptyComponent={
            messages === undefined ? (
              <View style={{ paddingTop: 40, alignItems: "center" }}>
                <Spinner />
              </View>
            ) : undefined
          }
        />
      )}
      {/* Inverted lists don't get iOS's scroll-edge effect under the header, so fade the paper in by hand. */}
      {!empty ? <View pointerEvents="none" style={[s.edge, { height: headerHeight + 28 }]} /> : null}
      <View style={{ paddingHorizontal: 12 }}>
        <Composer onSend={onSend} disabled={busy} autoFocus={false} />
      </View>
    </Animated.View>
  );
}

function MessageRow({ m }: { m: Message }) {
  if (m.role === "user") {
    return (
      <Animated.View entering={enter} style={{ alignItems: "flex-end" }}>
        <View style={s.bubble}>
          <Text style={[type.body, { fontSize: 15.5, lineHeight: 22 }]} selectable>
            {m.text}
          </Text>
        </View>
      </Animated.View>
    );
  }
  if (m.kind === "nudge")
    return (
      <Animated.View entering={enter}>
        <NudgeCard m={m} />
      </Animated.View>
    );
  if (m.kind === "approval")
    return (
      <Animated.View entering={enter}>
        <ApprovalCard m={m} />
      </Animated.View>
    );
  if (m.kind === "update")
    return (
      <Animated.View entering={enter}>
        <UpdateRow m={m} />
      </Animated.View>
    );

  const thinking = m.status === "streaming" && !m.text && !m.tools?.length;
  return (
    <Animated.View entering={enter} style={{ flexDirection: "row", gap: 11 }}>
      <View style={{ paddingTop: 2 }}>
        <WaliMark size={24} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {m.tools?.map((t) => <ToolCall key={t.toolCallId} tool={t} />)}
        {thinking ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 26 }}>
            <Spinner />
            <Text style={[type.meta, { fontSize: 14 }]}>Thinking</Text>
          </View>
        ) : null}
        {m.text ? (
          <View style={m.tools?.length ? { marginTop: 8 } : null}>
            <Markdown text={m.text} size={16} />
          </View>
        ) : null}
        {m.status === "error" ? (
          <View style={s.error}>
            <Text style={[type.secondary, { fontSize: 14 }]}>{m.error ?? "Something went wrong."}</Text>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  edge: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    experimental_backgroundImage: "linear-gradient(to bottom, rgba(246,244,239,1) 0%, rgba(246,244,239,0.94) 62%, rgba(246,244,239,0) 100%)",
  },
  empty: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 22, paddingBottom: 40 },
  suggestions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 28 },
  suggestion: { borderRadius: 999, backgroundColor: color.tint, paddingHorizontal: 15, paddingVertical: 10 },
  suggestionText: { fontFamily: font.body, fontSize: 14, color: color.ink2 },
  bubble: {
    maxWidth: "86%",
    backgroundColor: color.bubble,
    borderRadius: 22,
    borderBottomRightRadius: 8,
    borderCurve: "continuous",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  error: { marginTop: 6, backgroundColor: color.tint, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
});
