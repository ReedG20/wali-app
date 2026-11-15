import { useQuery } from "convex/react";
import { router, Stack } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { api, type Recording } from "../../../lib/convex";
import { clockTime, duration, formatDate } from "../../../lib/time";
import { closeOpen, recorderStore } from "../../../lib/recorder";
import { IDLE_CLOSE_MS } from "../../../lib/segment";
import { useStoreSelector } from "../../../lib/store";
import { useLocalSegments } from "../../../lib/useLocalSegments";
import { largeTitle } from "../../../navigation";
import { color, display, font, type } from "../../../theme";
import { Card, Icon, Lede, Loading, Spinner } from "../../../ui";

const LOCAL_LABEL: Record<string, string> = {
  recording: "Saving on this phone",
  queued: "Waiting to upload",
  uploading: "Uploading",
  broken: "Couldn't upload",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting to transcribe",
  transcribing: "Transcribing",
  empty: "Silent",
  failed: "Transcription failed",
};

function dayLabel(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return formatDate(d, { weekday: "long", month: "short", day: "numeric" });
}

const clock = clockTime;

/**
 * "1 voice" / "2 voices". Transcription sometimes splits a word or two off as a second speaker,
 * which made a 2-second clip claim two voices; a speaker needs a second of speech to count.
 */
function voices(speakers: { seconds: number }[]) {
  const n = Math.max(1, speakers.filter((sp) => sp.seconds >= 1).length);
  return `${n} ${n === 1 ? "voice" : "voices"}`;
}

/** What the pendant heard: each finished conversation, grouped by day, plus anything still on the phone. */
export default function Transcripts() {
  const recordings = useQuery(api.recordings.list, { limit: 80 });
  const { rows } = useLocalSegments(50);
  const pending = rows.filter((r) => r.state !== "uploaded");
  const openId = useStoreSelector(recorderStore, (st) => st.openSegmentId);
  const [query, setQuery] = useState("");

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Clips with no words in them ("Silent") aren't conversations: they only cluttered the list.
    const list = (recordings ?? []).filter((r) => r.status !== "empty").filter((r) => !q || (r.preview ?? "").toLowerCase().includes(q));
    const groups = new Map<string, Recording[]>();
    for (const r of list) {
      const k = dayLabel(r.startedAt);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    return [...groups].map(([title, data]) => ({ title, data }));
  }, [recordings, query]);

  return (
    <>
      <Stack.Screen options={{ ...largeTitle, title: "Transcripts" }} />
      <Stack.SearchBar placeholder="Search what was said" onChangeText={(e) => setQuery(e.nativeEvent.text)} hideWhenScrolling />
      <SectionList
        sections={sections}
        keyExtractor={(r) => r._id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled={false}
        style={{ backgroundColor: color.paper }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        ListHeaderComponent={
          <>
            <Lede>Each finished conversation, as transcribed. Speakers are numbered per conversation.</Lede>
            {pending.length > 0 ? (
              <Card padded={false} style={{ marginBottom: 8 }}>
                {pending.map((r, i) =>
                  r.id === openId ? (
                    <LiveRow key={r.id} startedAt={r.startedAt ?? r.firstFrameAt} first={i === 0} />
                  ) : (
                    <View key={r.id} style={[s.localRow, i > 0 && s.line]}>
                      <Icon
                        name={r.state === "broken" ? "exclamationmark.triangle" : r.state === "uploading" ? "icloud.and.arrow.up" : "iphone"}
                        size={16}
                        tint={r.state === "broken" ? "#8A3B12" : color.ink2}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={type.label}>{LOCAL_LABEL[r.state] ?? r.state}</Text>
                        <Text style={type.meta} numberOfLines={2}>
                          {clock(r.startedAt ?? r.firstFrameAt)} · {duration(r.durationMs ?? (r.seqEnd - r.seqStart + 1) * 20)}
                          {r.lastError ? ` · ${r.lastError}` : ""}
                        </Text>
                      </View>
                    </View>
                  ),
                )}
              </Card>
            ) : null}
          </>
        }
        renderSectionHeader={({ section }) => <Text style={[display(22), { marginTop: 22, marginBottom: 10 }]}>{section.title}</Text>}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={
          recordings === undefined ? (
            <Loading fill={false} />
          ) : (
            <Card>
              <Text style={[type.secondary, { fontSize: 14.5 }]}>
                {query ? "Nothing matches that." : "Nothing yet. Connect your pendant on the Pendant tab and talk."}
              </Text>
            </Card>
          )
        }
        renderItem={({ item: r }) => (
          <Pressable onPress={() => router.push({ pathname: "/(app)/transcripts/[id]", params: { id: r._id } })} style={({ pressed }) => pressed && { opacity: 0.85 }}>
            <View style={s.card}>
              <View style={s.meta}>
                {/* Approximate start times (clips synced later) are marked on the detail page, not with a "~" here. */}
                <Text style={[type.label, { fontSize: 14 }]}>{clock(r.startedAt)}</Text>
                <Text style={type.meta}>· {duration(r.durationMs)}</Text>
                {r.status !== "done" ? <Text style={type.meta}>· {STATUS_LABEL[r.status] ?? r.status}</Text> : null}
                {r.status === "pending" || r.status === "transcribing" ? <Spinner /> : null}
                <View style={{ flex: 1 }} />
                {r.speakers?.length ? <Text style={type.meta}>{voices(r.speakers)}</Text> : null}
              </View>
              {r.preview || r.error ? (
                <Text style={[type.bodySm, { marginTop: 6, color: r.status === "failed" ? color.ink2 : color.ink }]} numberOfLines={3}>
                  {r.status === "failed" ? r.error : r.preview}
                </Text>
              ) : null}
            </View>
          </Pressable>
        )}
      />
    </>
  );
}

/**
 * The conversation the pendant is hearing right now. It becomes a transcript once it ends (after
 * IDLE_CLOSE_MS of quiet, or 5 min), so without this row nothing visible happens while you talk.
 * Its own component: the frame count changes several times a second while audio streams.
 */
function LiveRow({ startedAt, first }: { startedAt: number; first: boolean }) {
  const frames = useStoreSelector(recorderStore, (st) => st.openSegmentFrames);
  return (
    <View style={[s.localRow, !first && s.line]}>
      <Icon name="waveform" size={16} tint={color.ink} />
      <View style={{ flex: 1 }}>
        <Text style={type.label}>Listening now</Text>
        <Text style={type.meta} numberOfLines={2}>
          {clock(startedAt)} · {duration(frames * 20)} so far · transcribed after {Math.round(IDLE_CLOSE_MS / 1000)} s of quiet
        </Text>
      </View>
      <Pressable onPress={() => closeOpen()} hitSlop={8} style={({ pressed }) => pressed && { opacity: 0.6 }}>
        <Text style={[type.label, { fontSize: 14 }]}>Transcribe now</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: color.card,
    borderRadius: 20,
    borderCurve: "continuous",
    padding: 16,
    boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 14px 30px -26px rgba(0,0,0,0.35)",
  },
  meta: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" },
  localRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  _f: { fontFamily: font.body },
});
