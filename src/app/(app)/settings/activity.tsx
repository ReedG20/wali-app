import { useMutation, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { errorText } from "../../../chat/Cards";
import { api } from "../../../lib/convex-api";
import { friendlyError } from "../../../lib/errors";
import { timeLabel } from "../../../lib/time";
import type { GateEvent } from "../../../lib/types";
import { color, font, type } from "../../../theme";
import { Card, Empty, Icon, Lede, Loading, Page, Pill, SectionHead } from "../../../ui";

const TRIGGER: Record<string, string> = {
  transcript: "Conversation ended",
  schedule: "Hourly check-in",
  followup: "Follow-up",
  manual: "You asked",
  simulated: "Simulated",
};

type Followup = { _id: Id<"followups">; note: string; runAt: number; status: string };

/** What wali did with each decision ("nothing: …", "nudge: …" from the backend), in plain words. */
const OUTCOME: Record<string, string> = {
  nothing: "Stayed quiet",
  nudge: "Messaged you",
  ask_first: "Asked for your OK",
  act: "Took care of it",
  follow_up: "Set a follow-up",
  support: "Checked in",
  error: "Couldn't finish",
};

const HELD_REASON: Record<string, string> = {
  "Gate chose to keep listening": "Kept listening",
  "Nothing was said": "Nothing was said",
};

/** "nothing: no action needed" -> { kind: "nothing", why: "no action needed" } */
function parseDecision(d?: string): { kind: string; why: string } | null {
  if (!d) return null;
  const m = /^(\w+):\s*([\s\S]*)$/.exec(d);
  return m ? { kind: m[1], why: m[2].trim() } : { kind: "", why: d };
}

/** "[Sun 3:15 AM] Speaker 1: hello" -> "Speaker 1: hello" (the card already shows the time). */
const cleanExcerpt = (t: string) => t.replace(/\[[A-Za-z]{3} \d{1,2}:\d{2}\s?[AP]M\]\s*/g, "").trim();

const URGENCY = ["Low", "Low", "Medium", "High"];

/** Every time wali considered speaking, how it decided, and the follow-ups it scheduled. */
export default function Activity() {
  const events = useQuery(api.activity.gateEvents, { limit: 60 }) as GateEvent[] | undefined;
  const followups = (useQuery(api.activity.followups) ?? []) as Followup[];
  const cancel = useMutation(api.activity.cancelFollowup);
  const upcoming = followups.filter((f) => f.status === "scheduled");

  return (
    <>
      <Stack.Screen options={{ title: "Activity", headerLargeTitle: false }} />
      <Page>
        <Lede>Every time wali weighed whether to speak up, and what it decided.</Lede>

        <SectionHead title="Follow-ups" description="Wake-ups wali scheduled for itself." />
        {upcoming.length === 0 ? (
          <Empty>None scheduled.</Empty>
        ) : (
          <Card padded={false}>
            {upcoming.map((f, i) => (
              <View key={f._id} style={[s.row, i > 0 && s.line]}>
                <View style={{ flex: 1 }}>
                  <Text style={type.bodySm}>{f.note}</Text>
                  <Text style={[type.meta, { fontSize: 12.5 }]}>{timeLabel(f.runAt)}</Text>
                </View>
                <Pill
                  title="Cancel"
                  size="sm"
                  kind="secondary"
                  onPress={() =>
                    Alert.alert("Cancel this follow-up?", f.note, [
                      { text: "Keep", style: "cancel" },
                      { text: "Cancel it", style: "destructive", onPress: () => void cancel({ id: f._id }).catch((e) => Alert.alert("Couldn't cancel", errorText(e, "Try again."))) },
                    ])
                  }
                />
              </View>
            ))}
          </Card>
        )}

        <SectionHead title="Recent moments" description="wali only weighs conversations that had words in them, while your pendant is linked to your account." />
        <View style={{ gap: 10 }}>
          {!events ? <Loading fill={false} /> : null}
          {events?.length === 0 ? (
            <Card style={{ gap: 12, alignItems: "flex-start" }}>
              <Text style={[type.secondary, { fontSize: 14.5 }]}>Nothing yet. Run a sample conversation to see how wali decides.</Text>
              <Pill title="Try it" size="sm" onPress={() => router.push("/(app)/settings/try")} />
            </Card>
          ) : null}
          {events?.map((e) => <EventCard key={e._id} e={e} />)}
        </View>
      </Page>
    </>
  );
}

function EventCard({ e }: { e: GateEvent }) {
  const [open, setOpen] = useState(false);
  const d = parseDecision(e.decision);
  // The badge says what happened, not which stage let it through: "Passed" on an entry where wali
  // then did nothing read like something had been sent.
  const acted = e.passed && !!d && d.kind !== "nothing" && d.kind !== "error";
  const badge = !e.passed ? "Stayed quiet" : !d ? "Deciding…" : (OUTCOME[d.kind] ?? "Considered");
  const excerpt = e.excerpt ? cleanExcerpt(e.excerpt) : "";
  return (
    <Card style={{ padding: 16 }}>
      <View style={s.head}>
        <View style={[s.badge, acted && { backgroundColor: color.ink }]}>
          <Text style={[s.badgeText, acted && { color: "#FFFFFF" }]}>{badge}</Text>
        </View>
        <Text style={[type.meta, { flex: 1 }]} numberOfLines={1}>
          {TRIGGER[e.trigger.kind] ?? e.trigger.kind}
        </Text>
        <Text style={[type.meta, { fontSize: 12 }]}>{timeLabel(e.createdAt)}</Text>
      </View>
      {excerpt ? (
        <Text style={[type.secondary, { fontSize: 13.5, lineHeight: 20, marginTop: 10 }]} numberOfLines={3}>
          {excerpt}
        </Text>
      ) : null}
      <Text style={[type.bodySm, { marginTop: 8 }]}>
        {d?.kind === "error" ? friendlyError(d.why, "Something went wrong while deciding.") : d?.why || HELD_REASON[e.reason] || e.reason}
      </Text>
      {e.scores ? (
        <>
          <Pressable onPress={() => setOpen((o) => !o)} style={s.toggle} hitSlop={8}>
            <Text style={[type.meta, { fontSize: 12.5 }]}>How it was weighed</Text>
            <Icon name={open ? "chevron.up" : "chevron.down"} size={10} tint={color.ink3} />
          </Pressable>
          {open ? (
            <View style={s.scores}>
              <Score label="Worth acting on" v={e.scores.worthActing} />
              <Score label="You asked" v={e.scores.userAsked} />
              {e.scores.canHelp !== undefined ? <Score label="wali can help" v={e.scores.canHelp} /> : null}
              <Score label="Distress" v={e.scores.distress} />
              <Score label="Bad time" v={e.scores.badTime} />
              <Score label="Urgency" v={e.scores.urgency / 3} text={URGENCY[Math.max(0, Math.min(3, Math.round(e.scores.urgency)))]} />
            </View>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function Score({ label, v, text }: { label: string; v: number; text?: string }) {
  return (
    <View style={s.score}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={[type.meta, { fontSize: 12 }]}>{label}</Text>
        <Text style={[type.meta, { fontSize: 12, color: color.ink }]}>{text ?? `${Math.round(v * 100)}%`}</Text>
      </View>
      <View style={s.track}>
        <View style={[s.fill, { width: `${Math.max(2, Math.min(100, v * 100))}%` }]} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: { borderRadius: 999, backgroundColor: color.tint, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontFamily: font.medium, fontSize: 12, color: color.ink2 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10, alignSelf: "flex-start" },
  scores: { flexDirection: "row", flexWrap: "wrap", rowGap: 10, columnGap: 18, marginTop: 12 },
  score: { width: "46%" },
  track: { height: 4, borderRadius: 2, backgroundColor: color.tint, marginTop: 4, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 2, backgroundColor: "rgba(22,21,19,0.7)" },
});
