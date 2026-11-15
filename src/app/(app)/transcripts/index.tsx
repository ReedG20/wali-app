import { useQuery } from "convex/react";
import { router, Stack } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, View } from "react-native";
import { api, type Recording } from "../../../lib/convex";
import { clockTime, duration, formatDate } from "../../../lib/time";
import { useLocalSegments } from "../../../lib/useLocalSegments";
import { largeTitle } from "../../../navigation";
import { color, display, font, type } from "../../../theme";
import { Card, Icon, Lede, Spinner } from "../../../ui";

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

/** What the pendant heard: each finished conversation, grouped by day, plus anything still on the phone. */
export default function Transcripts() {
  const recordings = useQuery(api.recordings.list, { limit: 80 });
  const { rows } = useLocalSegments(50);
  const pending = rows.filter((r) => r.state !== "uploaded");
  const [query, setQuery] = useState("");

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (recordings ?? []).filter((r) => !q || (r.preview ?? "").toLowerCase().includes(q));
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
                {pending.map((r, i) => (
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
                ))}
              </Card>
            ) : null}
          </>
        }
        renderSectionHeader={({ section }) => <Text style={[display(22), { marginTop: 22, marginBottom: 10 }]}>{section.title}</Text>}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={
          recordings === undefined ? (
            <View style={{ paddingTop: 30 }}>
              <Spinner />
            </View>
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
                <Text style={[type.label, { fontSize: 14 }]}>
                  {r.timeApprox ? "~" : ""}
                  {clock(r.startedAt)}
                </Text>
                <Text style={type.meta}>· {duration(r.durationMs)}</Text>
                {r.status !== "done" ? <Text style={type.meta}>· {STATUS_LABEL[r.status] ?? r.status}</Text> : null}
                {r.status === "pending" || r.status === "transcribing" ? <Spinner /> : null}
                <View style={{ flex: 1 }} />
                {r.speakers?.length ? (
                  <Text style={type.meta}>
                    {r.speakers.length} {r.speakers.length === 1 ? "voice" : "voices"}
                  </Text>
                ) : null}
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
