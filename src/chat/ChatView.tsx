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
import { friendlyError } from "../lib/errors";
import { setActiveThread } from "../lib/notifications";
import { timeLabel } from "../lib/time";
import type { Message } from "../lib/types";
import { color, display, font, type } from "../theme";
import { Markdown } from "../ui/Markdown";
import { Loading, Spinner } from "../ui";
import { ApprovalCard, NudgeCard, UpdateRow } from "./Cards";
import { Composer } from "./Composer";
import { ToolCall } from "./ToolCall";

const SUGGESTIONS = [
  "What did I promise people today?",
  "Who did I talk to this afternoon?",
  "What's on my calendar tomorrow?",
  "Remind me to call Mom after my 3pm",
];

const enter = FadeInDown.duration(500).springify().damping(22);

/** A time line goes above a message when this much time passed since the one before it. */
const TIME_GAP_MS = 20 * 60 * 1000;

type Row = { m: Message; time: boolean };

/**
 * Convex replays an optimistic update on every server transition until the mutation lands, each
 * time with the same args object. The pending row must keep one id and one time across replays,
 * or its list key changes and the "Sending…" bubble remounts.
 */
const pendingRows = new WeakMap<object, { id: string; at: number }>();
function pendingIdentity(args: object) {
  let row = pendingRows.get(args);
  if (!row) {
    const at = Date.now();
    row = { id: `pending:${at}:${Math.random().toString(36).slice(2)}`, at };
    pendingRows.set(args, row);
  }
  return row;
}

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
  const sendMutation = useMutation(api.messages.send);
  // Show the message the moment it's sent. Without this, a slow or reconnecting socket cleared the
  // field and showed nothing until the server answered (it looked like the message was lost).
  // Convex swaps this row for the real one when the mutation lands, and removes it if it fails.
  const send = useMemo(
    () =>
      sendMutation.withOptimisticUpdate((store, args) => {
        const current = store.getQuery(api.messages.list, { threadId: args.threadId }) as Message[] | undefined;
        if (current === undefined) return;
        const { id, at } = pendingIdentity(args);
        const pending = {
          _id: id,
          threadId: args.threadId,
          role: "user",
          kind: "text",
          status: "done",
          text: args.text,
          createdAt: at,
          approval: null,
          browserTask: null,
          pending: true,
        } as unknown as Message;
        store.setQuery(api.messages.list, { threadId: args.threadId }, [...current, pending]);
      }),
    [sendMutation],
  );
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const kb = useReanimatedKeyboardAnimation();
  const busy = !!messages?.some((m) => m.status === "streaming");

  // Bottom space is the tab bar (safe-area inset) when the keyboard is down, the keyboard when up.
  const bottom = useAnimatedStyle(() => ({ paddingBottom: Math.max(insets.bottom, -kb.height.value) + 8 }));

  /** Resolves false when the message didn't go, so the composer can put the text back. */
  const onSend = useCallback(
    async (text: string) => {
      try {
        await send({ threadId, text });
        return true;
      } catch (e) {
        Alert.alert("Couldn't send", friendlyError(e, "Try again."));
        return false;
      }
    },
    [send, threadId],
  );

  // Newest first for the inverted list. `time` is decided in reading order (oldest first).
  const data = useMemo(() => {
    if (!messages) return [];
    const rows: Row[] = messages.map((m, i) => ({
      m,
      time: i === 0 || m.createdAt - messages[i - 1].createdAt > TIME_GAP_MS,
    }));
    return rows.reverse();
  }, [messages]);
  const loading = messages === undefined;
  const empty = messages && messages.length === 0;
  // Paper is solid behind the whole header, then fades out just below it, so the title and the
  // "Listening" line never sit on top of message text.
  const edgeHeight = headerHeight + 28;
  const solid = Math.round((headerHeight / edgeHeight) * 100);
  const edge = {
    height: edgeHeight,
    experimental_backgroundImage: `linear-gradient(to bottom, rgba(246,244,239,1) 0%, rgba(246,244,239,1) ${Math.max(0, solid - 12)}%, rgba(246,244,239,0.92) ${solid}%, rgba(246,244,239,0) 100%)`,
  };

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: color.paper }, bottom]}>
      {loading ? (
        // Its own view, not the list's empty component: an inverted list draws that upside down
        // and at the bottom of the screen.
        <Loading />
      ) : empty ? (
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
          keyExtractor={(r) => r.m._id}
          renderItem={({ item }) => <MessageRow m={item.m} time={item.time} />}
          // Inverted lists flip the automatic header inset to the bottom, so pad by hand
          // (paddingBottom is the visual top here).
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustsScrollIndicatorInsets={false}
          scrollIndicatorInsets={{ bottom: headerHeight }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: headerHeight + 16, gap: 22 }}
        />
      )}
      {/* Inverted lists don't get iOS's scroll-edge effect under the header, so fade the paper in by hand. */}
      {!empty && !loading ? <View pointerEvents="none" style={[s.edge, edge]} /> : null}
      <View style={{ paddingHorizontal: 12 }}>
        <Composer onSend={onSend} disabled={busy || loading} autoFocus={false} />
      </View>
    </Animated.View>
  );
}

/**
 * No entering animation on rows: with Reanimated layout animations inside the inverted list, whole
 * threads were left stuck at about 10% opacity after a slow load and while the keyboard was up.
 */
function MessageRow({ m, time }: { m: Message; time: boolean }) {
  return (
    <View style={{ gap: 14 }}>
      {time ? <Text style={s.time}>{timeLabel(m.createdAt)}</Text> : null}
      <MessageBody m={m} />
    </View>
  );
}

function MessageBody({ m }: { m: Message }) {
  if (m.role === "user") {
    return (
      <View style={{ alignItems: "flex-end" }}>
        <View style={[s.bubble, m.pending && { opacity: 0.6 }]}>
          <Text style={[type.body, { fontSize: 15.5, lineHeight: 22 }]} selectable>
            {m.text}
          </Text>
        </View>
        {m.pending ? <Text style={[type.meta, { fontSize: 12, marginTop: 4, marginRight: 4 }]}>Sending…</Text> : null}
      </View>
    );
  }
  if (m.kind === "nudge") return <NudgeCard m={m} />;
  if (m.kind === "approval") return <ApprovalCard m={m} />;
  if (m.kind === "update") return <UpdateRow m={m} />;

  const thinking = m.status === "streaming" && !m.text && !m.tools?.length;
  return (
    <View style={{ flexDirection: "row", gap: 11 }}>
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
            <Text style={[type.secondary, { fontSize: 14 }]}>{m.error ? friendlyError(m.error, "Something went wrong.") : "Something went wrong."}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  edge: { position: "absolute", top: 0, left: 0, right: 0 },
  time: { fontFamily: font.body, fontSize: 12, color: color.ink3, textAlign: "center" },
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
