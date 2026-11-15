import { useMutation, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { router, Stack } from "expo-router";
import { Alert, StyleSheet, Text, View } from "react-native";
import { api } from "../../../lib/convex-api";
import { timeLabel } from "../../../lib/time";
import type { GateEvent } from "../../../lib/types";
import { color, font, type } from "../../../theme";
import { Card, Empty, Lede, Page, Pill, SectionHead, Spinner } from "../../../ui";

const TRIGGER: Record<string, string> = {
  transcript: "Conversation ended",
  schedule: "Hourly check-in",
  followup: "Follow-up",
  manual: "You asked",
  simulated: "Simulated",
};

type Followup = { _id: Id<"followups">; note: string; runAt: number; status: string };

/** Every time wali considered speaking, with Jev's scores, and the follow-ups it scheduled. */
export default function Activity() {
  const events = useQuery(api.activity.gateEvents, { limit: 60 }) as GateEvent[] | undefined;
  const followups = (useQuery(api.activity.followups) ?? []) as Followup[];
  const cancel = useMutation(api.activity.cancelFollowup);
  const upcoming = followups.filter((f) => f.status === "scheduled");

  return (
    <>
      <Stack.Screen options={{ title: "Activity", headerLargeTitle: true }} />
      <Page>
        <Lede>Jev scores each moment; rules and the agent make the final call.</Lede>

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
                      { text: "Cancel it", style: "destructive", onPress: () => void cancel({ id: f._id }) },
                    ])
                  }
                />
              </View>
            ))}
          </Card>
        )}

        <SectionHead title="Gate log" />
        <View style={{ gap: 10 }}>
          {!events ? <Spinner /> : null}
          {events?.length === 0 ? (
            <Card style={{ gap: 12, alignItems: "flex-start" }}>
              <Text style={[type.secondary, { fontSize: 14.5 }]}>Nothing yet. Run a sample conversation to see the pipeline work.</Text>
              <Pill title="Try it" size="sm" onPress={() => router.push("/(app)/settings/try")} />
            </Card>
          ) : null}
          {events?.map((e) => (
            <Card key={e._id} style={{ padding: 16 }}>
              <View style={s.head}>
                <View style={[s.badge, e.passed && { backgroundColor: color.ink }]}>
                  <Text style={[s.badgeText, e.passed && { color: "#FFFFFF" }]}>{e.passed ? "Passed" : "Held"}</Text>
                </View>
                <Text style={[type.meta, { flex: 1 }]} numberOfLines={1}>
                  {TRIGGER[e.trigger.kind] ?? e.trigger.kind}
                </Text>
                <Text style={[type.meta, { fontSize: 12 }]}>{timeLabel(e.createdAt)}</Text>
              </View>
              <Text style={[type.label, { marginTop: 10, fontSize: 14.5 }]}>{e.reason}</Text>
              {e.excerpt ? (
                <Text style={[type.secondary, { fontSize: 13.5, lineHeight: 20, marginTop: 4 }]} numberOfLines={3}>
                  {e.excerpt}
                </Text>
              ) : null}
              {e.scores ? (
                <View style={s.scores}>
                  <Score label="Worth acting" v={e.scores.worthActing} />
                  <Score label="User asked" v={e.scores.userAsked} />
                  {e.scores.canHelp !== undefined ? <Score label="wali can help" v={e.scores.canHelp} /> : null}
                  <Score label="Distress" v={e.scores.distress} />
                  <Score label="Bad time" v={e.scores.badTime} />
                  <Score label="Urgency" v={e.scores.urgency / 3} text={`${e.scores.urgency.toFixed(1)} / 3`} />
                  <View style={s.score}>
                    <Text style={[type.meta, { fontSize: 12 }]}>
                      Kind <Text style={{ color: color.ink }}>{e.scores.kind}</Text>
                    </Text>
                  </View>
                </View>
              ) : null}
              {e.decision ? (
                <View style={s.decision}>
                  <Text style={[type.secondary, { fontSize: 13.5 }]}>
                    <Text style={{ color: color.ink, fontFamily: font.medium }}>Agent: </Text>
                    {e.decision}
                  </Text>
                </View>
              ) : null}
            </Card>
          ))}
        </View>
      </Page>
    </>
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
  scores: { flexDirection: "row", flexWrap: "wrap", rowGap: 10, columnGap: 18, marginTop: 14 },
  score: { width: "46%" },
  track: { height: 4, borderRadius: 2, backgroundColor: color.tint, marginTop: 4, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 2, backgroundColor: "rgba(22,21,19,0.7)" },
  decision: { marginTop: 12, backgroundColor: color.paper, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
});
