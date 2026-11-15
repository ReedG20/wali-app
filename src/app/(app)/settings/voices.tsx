import { useMutation, useQuery } from "convex/react";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import * as Haptics from "expo-haptics";
import { Stack } from "expo-router";
import { useState } from "react";
import { ActionSheetIOS, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../../../lib/convex-api";
import { friendlyError } from "../../../lib/errors";
import { ago } from "../../../lib/time";
import { heard, quote, sameAsName, sameAsTarget, type KnownPerson, type Overview, type Person, type Target, type Voice } from "../../../lib/voices";
import { color, display, type } from "../../../theme";
import { Card, Empty, Icon, Lede, Loading, Page, Pill, Row, SectionHead } from "../../../ui";
import { pickPerson, promptName } from "../../../ui/pickPerson";

const since = (v: { recordingCount: number; lastHeardAt: number | null }) => heard(v, ago);

/** One clip plays at a time. `key` is the voice it belongs to. */
function useClips() {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<string | null>(null);
  return {
    playing: (key: string) => current === key && status.playing,
    async toggle(key: string, url: string) {
      if (current === key && status.playing) return player.pause();
      await setAudioModeAsync({ playsInSilentMode: true });
      if (current !== key) {
        player.replace({ uri: url });
        setCurrent(key);
      } else await player.seekTo(0);
      player.play();
    },
  };
}
type Clips = ReturnType<typeof useClips>;

function PlayButton({ clips, id, url }: { clips: Clips; id: string; url: string | null }) {
  if (!url) return null;
  const on = clips.playing(id);
  return (
    <Pressable
      onPress={() => void clips.toggle(id, url).catch((e) => Alert.alert("Couldn't play that", friendlyError(e, "Try again.")))}
      accessibilityRole="button"
      accessibilityLabel={on ? "Pause" : "Play their voice"}
      hitSlop={6}
      style={({ pressed }) => [s.play, pressed && { opacity: 0.7 }]}
    >
      <Icon name={on ? "pause.fill" : "play.fill"} size={13} tint={color.ink} />
    </Pressable>
  );
}

/** The people wali knows and the voices it keeps hearing, with the same naming tools as the web. */
export default function Voices() {
  const data = useQuery(api.voices.overview) as Overview | null | undefined;
  const people = (useQuery(api.voices.people) ?? []) as KnownPerson[];
  const nameVoice = useMutation(api.voices.nameVoice);
  const unnameVoice = useMutation(api.voices.unnameVoice);
  const dismissMe = useMutation(api.voices.dismissMe);
  const setIgnored = useMutation(api.voices.setIgnored);
  const dismissName = useMutation(api.voices.dismissNameSuggestion);
  const renamePerson = useMutation(api.voices.renamePerson);
  const clips = useClips();

  /** Run a change; a quiet tap on success, an alert with a plain reason on failure. */
  function run(p: Promise<unknown>, failTitle = "Couldn't save that") {
    p.then(
      () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
      (e) => Alert.alert(failTitle, friendlyError(e, "Try again.")),
    );
  }

  async function name(v: Voice) {
    const picked = await pickPerson({
      title: "Who's this?",
      message: v.sampleText ? quote(v.sampleText) : "wali will use this name in every conversation with this voice, including past ones.",
      people,
      suggestion: v.nameSuggestion?.name,
      extras: [{ key: "background", label: "Background (TV, a podcast…)" }],
    });
    if (!picked) return;
    if ("extra" in picked) run(setIgnored({ voiceId: v._id, ignored: true }));
    else run(nameVoice({ voiceId: v._id, ...picked.target }));
  }

  function personMenu(p: Person) {
    const options = ["Rename", ...(p.voices.length ? ["Forget voice"] : []), "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: p.name,
        message: p.voices.length ? since(p) : "Named in a transcript. wali hasn't learned their voice yet.",
        options,
        cancelButtonIndex: options.length - 1,
        destructiveButtonIndex: p.voices.length ? 1 : undefined,
      },
      (i) => {
        if (options[i] === "Rename") void rename(p);
        else if (options[i] === "Forget voice") forget(p);
      },
    );
  }

  async function rename(p: Person) {
    const next = await promptName(`Rename ${p.name}`, p.name, "Every conversation with them updates to the new name.");
    if (next && next !== p.name) run(renamePerson({ personId: p._id, name: next }), "Couldn't rename");
  }

  function forget(p: Person) {
    Alert.alert(`Forget ${p.name}'s voice?`, "Their conversations go back to an unnamed speaker. You can name the voice again later.", [
      { text: "Cancel", style: "cancel" },
      { text: "Forget", style: "destructive", onPress: () => run(Promise.all(p.voices.map((v) => unnameVoice({ voiceId: v._id }))), "Couldn't forget that voice") },
    ]);
  }

  return (
    <>
      <Stack.Screen options={{ title: "Voices", headerLargeTitle: false }} />
      <Page>
        <Lede>wali learns voices as it hears them. Name someone once and every conversation with them, past and future, uses that name.</Lede>

        {data === undefined ? <Loading fill={false} /> : null}
        {data === null ? <Empty>Sign in to see voices.</Empty> : null}

        {data?.meSuggestion ? (
          <Card style={{ gap: 12 }}>
            <Text style={display(24)}>Is this you?</Text>
            <Text style={[type.secondary, { fontSize: 14.5, lineHeight: 21 }]}>
              This voice is in {data.meSuggestion.recordingCount} of your conversations and is usually the closest to the pendant.
            </Text>
            {data.meSuggestion.clipUrl || data.meSuggestion.sampleText ? (
              <View style={s.clipRow}>
                <PlayButton clips={clips} id={data.meSuggestion._id} url={data.meSuggestion.clipUrl} />
                {data.meSuggestion.sampleText ? (
                  <Text style={[type.meta, { flex: 1 }]} numberOfLines={2}>
                    “{data.meSuggestion.sampleText}”
                  </Text>
                ) : null}
              </View>
            ) : null}
            <View style={s.actions}>
              <Pill title="Yes, that's me" size="sm" onPress={() => run(nameVoice({ voiceId: data.meSuggestion!._id, me: true }))} />
              <Pill title="No" size="sm" kind="secondary" onPress={() => run(dismissMe({ voiceId: data.meSuggestion!._id }))} />
            </View>
          </Card>
        ) : null}

        {data ? (
          <>
            <SectionHead title="People" description={data.people.length ? undefined : "No one named yet. Name a voice below, or tap a speaker in a transcript."} />
            {data.people.length ? (
              <Card padded={false}>
                {data.people.map((p, i) => (
                  <Row
                    key={p._id}
                    first={i === 0}
                    title={p.name}
                    subtitle={`${p.isMe ? "You · " : ""}${p.voices.length ? since(p) : "Named in a transcript"}`}
                    onPress={() => personMenu(p)}
                    chevron={false}
                    trailing={
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <PlayButton clips={clips} id={p._id} url={p.voices.find((v) => v.clipUrl)?.clipUrl ?? null} />
                        <Icon name="ellipsis" size={15} tint={color.ink3} />
                      </View>
                    }
                  />
                ))}
              </Card>
            ) : null}

            <SectionHead
              title="Voices you keep hearing"
              description={
                data.unnamed.length
                  ? "Unnamed voices that came up in more than one conversation."
                  : data.recordingsProcessed
                    ? "Nobody new is recurring right now."
                    : "Voices appear here after a few conversations."
              }
            />
            <View style={{ gap: 10 }}>
              {data.unnamed.map((v) => (
                <VoiceCard
                  key={v._id}
                  v={v}
                  people={data.people}
                  clips={clips}
                  onName={() => void name(v)}
                  onAccept={(t) => run(nameVoice({ voiceId: v._id, ...t }))}
                  onDismissName={() => run(dismissName({ voiceId: v._id }))}
                />
              ))}
              {data.oneOffCount > 0 ? (
                <Text style={[type.meta, { paddingHorizontal: 4 }]}>
                  Plus {data.oneOffCount} voice{data.oneOffCount === 1 ? "" : "s"} heard only once. You can name those from a transcript.
                </Text>
              ) : null}
            </View>

            {data.background.length ? (
              <>
                <SectionHead title="Background" description="Labelled “Background” in transcripts and never asked about." />
                <Card padded={false}>
                  {data.background.map((v, i) => (
                    <Row
                      key={v._id}
                      first={i === 0}
                      title={since(v)}
                      subtitle={v.sampleText ? `“${v.sampleText}”` : undefined}
                      trailing={
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                          <PlayButton clips={clips} id={v._id} url={v.clipUrl} />
                          <Pill title="Not background" size="sm" kind="secondary" onPress={() => run(setIgnored({ voiceId: v._id, ignored: false }))} />
                        </View>
                      }
                    />
                  ))}
                </Card>
              </>
            ) : null}
          </>
        ) : null}
      </Page>
    </>
  );
}

function VoiceCard({
  v,
  people,
  clips,
  onName,
  onAccept,
  onDismissName,
}: {
  v: Voice;
  people: Person[];
  clips: Clips;
  onName: () => void;
  onAccept: (t: Target) => void;
  onDismissName: () => void;
}) {
  const likeName = v.nameSuggestion ? null : sameAsName(v, people);
  const likeTarget = likeName ? sameAsTarget(v, people) : null;
  return (
    <Card style={{ padding: 16, gap: 12 }}>
      <View style={s.clipRow}>
        <PlayButton clips={clips} id={v._id} url={v.clipUrl} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={type.label} numberOfLines={1}>
            {since(v)}
          </Text>
          {v.sampleText ? (
            <Text style={[type.meta, { marginTop: 1 }]} numberOfLines={2}>
              “{v.sampleText}”
            </Text>
          ) : null}
        </View>
        <Pill title="Name" size="sm" onPress={onName} />
      </View>
      {v.nameSuggestion ? (
        <View style={s.hint}>
          <Text style={[type.secondary, { fontSize: 14, lineHeight: 20 }]}>
            Is this <Text style={{ color: color.ink }}>{v.nameSuggestion.name}</Text>? Someone said “{v.nameSuggestion.evidence}”
          </Text>
          <View style={s.actions}>
            <Pill title="Yes" size="sm" onPress={() => onAccept({ name: v.nameSuggestion!.name })} />
            <Pill title="No" size="sm" kind="secondary" onPress={onDismissName} />
          </View>
        </View>
      ) : likeName && likeTarget ? (
        <View style={[s.hint, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
          <Text style={[type.secondary, { fontSize: 14, lineHeight: 20, flex: 1 }]}>
            Sounds a bit like <Text style={{ color: color.ink }}>{likeName}</Text>.
          </Text>
          <Pill title={`It's ${likeName}`} size="sm" kind="secondary" onPress={() => onAccept(likeTarget)} />
        </View>
      ) : null}
    </Card>
  );
}

const s = StyleSheet.create({
  play: { width: 34, height: 34, borderRadius: 17, backgroundColor: color.tint, alignItems: "center", justifyContent: "center" },
  clipRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  hint: { borderRadius: 16, borderCurve: "continuous", backgroundColor: color.paper, padding: 12, gap: 10 },
});
