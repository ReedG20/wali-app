import { useMutation, useQuery } from "convex/react";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { api, type Utterance } from "../../../lib/convex";
import { friendlyError } from "../../../lib/errors";
import { wavFile } from "../../../lib/files";
import { clockTime, duration, formatDate } from "../../../lib/time";
import { color, display, font, type } from "../../../theme";
import { Card, Icon, Loading, Page, Pill } from "../../../ui";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

type Turn = { key: string; speakerLabel: string; startAt: number; text: string };

/**
 * One block per turn. Transcription returns a speaker's speech in several pieces, which read as
 * "Speaker 1: … Speaker 1: … to, Speaker 1: uh". Consecutive pieces from the same speaker are
 * joined unless there's a real pause between them.
 */
const SAME_TURN_GAP_MS = 8000;
function turns(utts: Utterance[]): Turn[] {
  const out: Turn[] = [];
  let lastEnd = 0;
  for (const u of utts) {
    const prev = out[out.length - 1];
    if (prev && prev.speakerLabel === u.speakerLabel && u.startAt - lastEnd < SAME_TURN_GAP_MS) prev.text = `${prev.text} ${u.text}`.trim();
    else out.push({ key: u._id, speakerLabel: u.speakerLabel, startAt: u.startAt, text: u.text });
    lastEnd = u.endAt;
  }
  return out;
}

export default function RecordingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rec = useQuery(api.recordings.get, { id });
  const utts = useQuery(api.utterances.forRecording, { recordingId: id });
  const retry = useMutation(api.recordings.retry);

  // Prefer the local WAV (clientId = local segment id), fall back to the server copy.
  const source = useMemo(() => {
    if (!rec) return null;
    const local = wavFile(rec.clientId);
    if (local.exists) return { uri: local.uri, where: "this phone" as const };
    return rec.audioUrl ? { uri: rec.audioUrl, where: "server" as const } : null;
  }, [rec]);
  const player = useAudioPlayer(source ? { uri: source.uri } : null);
  const ps = useAudioPlayerStatus(player);
  const blocks = useMemo(() => (utts ? turns(utts) : undefined), [utts]);
  // The recording's own speaker list keeps the neutral "Speaker 1" even after a voice has been
  // recognised, while the lines below use the name. Use the name in both places.
  const names = useMemo(() => new Map((utts ?? []).map((u) => [u.speakerRaw, u.speakerLabel])), [utts]);

  if (rec === undefined) return <Loading />;
  if (rec === null)
    return (
      <Page>
        <Text style={type.secondary}>This recording isn&apos;t there anymore.</Text>
      </Page>
    );

  async function toggle() {
    await setAudioModeAsync({ playsInSilentMode: true });
    if (ps.playing) player.pause();
    else {
      if (ps.didJustFinish || (ps.duration > 0 && ps.currentTime >= ps.duration - 0.05)) await player.seekTo(0);
      player.play();
    }
  }

  const progress = ps.duration > 0 ? ps.currentTime / ps.duration : 0;
  const total = rec.speakers?.reduce((a, s) => a + s.seconds, 0) ?? 0;

  return (
    <>
      <Stack.Screen options={{ title: formatDate(rec.startedAt, { month: "short", day: "numeric" }), headerLargeTitle: false }} />
      <Page>
        <Text style={[display(34), { marginTop: 8 }]}>
          {rec.timeApprox ? "Around " : ""}
          {clockTime(rec.startedAt)}
          <Text style={[display(34, true), { color: color.ink2 }]}> · {duration(rec.durationMs)}</Text>
        </Text>
        <Text style={[type.meta, { marginTop: 6 }]}>
          {formatDate(rec.startedAt, { weekday: "long", month: "long", day: "numeric" })}
          {rec.backfill ? " · synced from the pendant later" : ""}
        </Text>

        <Card style={{ marginTop: 22, flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Pressable
            onPress={toggle}
            disabled={!source || !ps.isLoaded}
            accessibilityRole="button"
            accessibilityLabel={ps.playing ? "Pause" : "Play"}
            style={[s.play, (!source || !ps.isLoaded) && { opacity: 0.35 }]}
          >
            <Icon name={ps.playing ? "pause.fill" : "play.fill"} size={18} tint="#FFFFFF" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <View style={s.track}>
              <View style={[s.fill, { width: `${Math.max(1, progress * 100)}%` }]} />
            </View>
            <Text style={[type.meta, { marginTop: 7, fontSize: 12 }]}>
              {source ? `${fmt(ps.currentTime)} / ${fmt(ps.duration || rec.durationMs / 1000)} · from ${source.where}` : "No audio available"}
            </Text>
          </View>
        </Card>

        {rec.status === "failed" || rec.status === "transcribing" || rec.status === "pending" ? (
          <Card style={{ marginTop: 12, gap: 12 }}>
            <Text style={[type.secondary, { fontSize: 14.5 }]}>
              {rec.status === "failed"
                ? `This one couldn't be transcribed${rec.error ? `: ${friendlyError(rec.error, "unknown reason")}` : "."}`
                : "Still transcribing. This updates on its own."}
            </Text>
            {rec.status !== "pending" ? (
              <Pill
                title="Try transcribing again"
                kind="secondary"
                size="sm"
                style={{ alignSelf: "flex-start" }}
                onPress={() => retry({ id: rec._id }).catch((e) => Alert.alert("Couldn't retry", friendlyError(e, "Try again.")))}
              />
            ) : null}
          </Card>
        ) : null}

        {rec.speakers?.length ? (
          <View style={{ marginTop: 26, gap: 10 }}>
            {rec.speakers.filter((sp) => sp.seconds >= 1 || rec.speakers!.length === 1).map((sp) => (
              <View key={sp.speakerRaw}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={[type.label, { fontSize: 14 }]}>{names.get(sp.speakerRaw) ?? sp.label}</Text>
                  <Text style={type.meta}>{duration(sp.seconds * 1000)}</Text>
                </View>
                <View style={[s.track, { marginTop: 5 }]}>
                  <View style={[s.fill, { width: `${total ? (sp.seconds / total) * 100 : 0}%`, backgroundColor: "rgba(22,21,19,0.55)" }]} />
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <View style={{ marginTop: 30, gap: 18 }}>
          {blocks === undefined && rec.status === "done" ? <Loading fill={false} /> : null}
          {blocks?.length === 0 && (rec.status === "done" || rec.status === "empty") ? <Text style={type.secondary}>No words in this one.</Text> : null}
          {blocks?.map((u) => (
            <View key={u.key}>
              <Text style={s.speaker}>
                {u.speakerLabel}
                <Text style={{ color: color.ink3 }}>  {fmt((u.startAt - rec.startedAt) / 1000)}</Text>
              </Text>
              <Text style={[type.body, { marginTop: 3 }]} selectable>
                {u.text}
              </Text>
            </View>
          ))}
        </View>
      </Page>
    </>
  );
}

const s = StyleSheet.create({
  play: { width: 46, height: 46, borderRadius: 23, backgroundColor: color.ink, alignItems: "center", justifyContent: "center" },
  track: { height: 4, borderRadius: 2, backgroundColor: color.tint, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: color.ink, borderRadius: 2 },
  speaker: { fontFamily: font.medium, fontSize: 13, color: color.ink2 },
});
