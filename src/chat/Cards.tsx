import { useMutation } from "convex/react";
import * as Haptics from "expo-haptics";
import { useState, type ReactNode } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { WaliMark } from "../brand";
import { api } from "../lib/convex-api";
import { friendlyError } from "../lib/errors";
import { timeLabel } from "../lib/time";
import type { Message } from "../lib/types";
import { color, font, type } from "../theme";
import { Card, Icon, Pill, Spinner } from "../ui";
import { Markdown } from "../ui/Markdown";

const TRIGGER_LABEL: Record<string, string> = {
  transcript: "After a conversation",
  schedule: "Check-in",
  followup: "Follow-up",
  manual: "You asked",
  simulated: "Simulated",
};

/** One plain sentence for an alert. Never the raw "[CONVEX A(...)] ... Called by client" text. */
export function errorText(e: unknown, fallback: string) {
  return friendlyError(e, fallback);
}

function CardShell({ header, time, children }: { header: ReactNode; time: number; children: ReactNode }) {
  return (
    <Card style={{ padding: 16 }}>
      <View style={s.head}>
        <WaliMark size={18} />
        <Text style={s.headText} numberOfLines={1}>
          {header}
        </Text>
        <Text style={[type.meta, { fontSize: 12 }]}>{timeLabel(time)}</Text>
      </View>
      {children}
    </Card>
  );
}

/** How wali speaks first: header, one or two specific sentences, up to two pill actions. */
export function NudgeCard({ m }: { m: Message }) {
  const respond = useMutation(api.messages.respond);
  const act = useMutation(api.messages.act);
  const [sending, setSending] = useState<string | null>(null);
  const chosen = m.chosenAction ?? sending;

  // The label goes back to wali as your reply (it lands right under this card).
  async function choose(action: string) {
    setSending(action);
    try {
      await act({ id: m._id, action });
    } catch (e) {
      Alert.alert("Couldn't send that", errorText(e, "Try again."));
    } finally {
      setSending(null);
    }
  }

  return (
    <CardShell
      time={m.createdAt}
      header={
        <>
          <Text style={{ fontFamily: font.medium, color: color.ink }}>wali</Text>
          {m.trigger ? <Text style={{ color: color.ink3 }}> · {TRIGGER_LABEL[m.trigger.kind] ?? m.trigger.kind}</Text> : null}
        </>
      }
    >
      <View style={{ marginTop: 10 }}>
        <Markdown text={m.text} size={15.5} />
      </View>
      <View style={s.actions}>
        {chosen ? (
          // Sent: a quiet confirmation (no onPress), or a spinner while it's on its way.
          <Pill title={chosen} size="sm" kind="secondary" icon={m.chosenAction ? "checkmark" : undefined} busy={!m.chosenAction} />
        ) : (
          (m.actions ?? []).map((a, i) => (
            <Pill key={a} title={a} size="sm" kind={i === 0 ? "primary" : "secondary"} onPress={() => void choose(a)} />
          ))
        )}
        <View style={{ flex: 1 }} />
        {(["helpful", "dismissed"] as const).map((r) => (
          <Pressable
            key={r}
            accessibilityLabel={r === "helpful" ? "Helpful" : "Not helpful"}
            accessibilityState={{ selected: m.response === r }}
            onPress={() => {
              void Haptics.selectionAsync();
              void respond({ id: m._id, response: r });
            }}
            style={[s.thumb, m.response === r && { backgroundColor: color.tint }]}
          >
            <Icon
              name={r === "helpful" ? (m.response === r ? "hand.thumbsup.fill" : "hand.thumbsup") : m.response === r ? "hand.thumbsdown.fill" : "hand.thumbsdown"}
              size={15}
              tint={m.response === r ? color.ink : color.ink3}
            />
          </Pressable>
        ))}
      </View>
    </CardShell>
  );
}

const APP_NAME: Record<string, string> = {
  gmail: "Gmail",
  googlecalendar: "Google Calendar",
  googledrive: "Google Drive",
  googledocs: "Google Docs",
  googlesheets: "Google Sheets",
  slack: "Slack",
  notion: "Notion",
  todoist: "Todoist",
  github: "GitHub",
};

/** GOOGLECALENDAR_CREATE_EVENT -> "Google Calendar: create event" */
function humanSlug(slug?: string) {
  if (!slug) return "";
  const [app, ...rest] = slug.toLowerCase().split("_");
  const name = APP_NAME[app] ?? `${app[0].toUpperCase()}${app.slice(1)}`;
  return rest.length ? `${name}: ${rest.join(" ")}` : name;
}

const STATUS_TEXT: Record<string, string> = {
  approved: "Approved, starting…",
  declined: "Skipped",
  running: "Running…",
  done: "Done",
  failed: "Didn't go through",
};

/** Same anatomy as a nudge, with "Needs your OK" and Approve / Skip. Approving runs exactly this. */
export function ApprovalCard({ m }: { m: Message }) {
  const decide = useMutation(api.approvals.decide);
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [open, setOpen] = useState(false);
  const a = m.approval;
  if (!a) return null;
  const pending = a.status === "pending";
  const args = a.channel === "browser" ? (a.args as { task?: string })?.task : JSON.stringify(a.args, null, 2);

  async function go(decision: "approve" | "decline") {
    setBusy(decision);
    try {
      await decide({ id: a!._id, decision });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert("Couldn't update that", errorText(e, "Try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <CardShell
      time={m.createdAt}
      header={
        <>
          <Text style={{ fontFamily: font.medium, color: color.ink }}>Needs your OK</Text>
          <Text style={{ color: color.ink3 }}> · {a.channel === "browser" ? "Browser" : humanSlug(a.toolSlug)}</Text>
        </>
      }
    >
      <View style={{ marginTop: 10 }}>
        <Markdown text={a.summary} size={15.5} />
      </View>
      {args ? (
        <>
          <Pressable onPress={() => setOpen((o) => !o)} style={s.detailsToggle} hitSlop={8}>
            <Text style={[type.meta, { fontSize: 12.5 }]}>Exactly what will run</Text>
            <Icon name={open ? "chevron.up" : "chevron.down"} size={10} tint={color.ink3} />
          </Pressable>
          {open ? (
            <View style={s.code}>
              <Text style={s.codeText} selectable>
                {args}
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
      <View style={s.actions}>
        {pending ? (
          <>
            <Pill title="Approve" size="sm" busy={busy === "approve"} disabled={!!busy} onPress={() => go("approve")} />
            <Pill title="Skip" size="sm" kind="secondary" busy={busy === "decline"} disabled={!!busy} onPress={() => go("decline")} />
          </>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {a.status === "approved" || a.status === "running" ? <Spinner /> : null}
            <Text style={[type.secondary, { fontSize: 13.5 }]}>
              {STATUS_TEXT[a.status] ?? a.status}
              {a.error ? <Text style={{ color: color.ink3 }}> · {friendlyError(a.error, "It didn't go through.")}</Text> : null}
            </Text>
          </View>
        )}
      </View>
    </CardShell>
  );
}

/**
 * When a browser task starts, the update message carries the full brief wali wrote for the
 * browser ("Go to… Log in with the user's existing account session… If login requires a password
 * or Duo/MFA, stop and report that."). That's an instruction to a machine, not something to read:
 * show one line, and keep the brief behind a toggle.
 */
const BROWSER_BRIEF = /^(Working on it in the browser)\s*[:.]\s*([\s\S]+)$/i;

/** Background work reporting back (browser tasks, approved actions). */
export function UpdateRow({ m }: { m: Message }) {
  const [open, setOpen] = useState(false);
  const t = m.browserTask;
  const running = t && (t.status === "starting" || t.status === "running");
  const brief = BROWSER_BRIEF.exec(m.text.trim());
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
      <View style={s.updateIcon}>{running ? <Spinner /> : <Icon name="globe" size={13} />}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {brief ? (
          <>
            <Text style={[type.secondary, { fontSize: 14.5 }]}>{running ? "Working on it in the browser…" : "Worked on it in the browser."}</Text>
            <Pressable onPress={() => setOpen((o) => !o)} style={s.detailsToggle} hitSlop={8}>
              <Text style={[type.meta, { fontSize: 12.5 }]}>What wali asked the browser to do</Text>
              <Icon name={open ? "chevron.up" : "chevron.down"} size={10} tint={color.ink3} />
            </Pressable>
            {open ? (
              <View style={s.code}>
                <Text style={[type.meta, { fontSize: 13, lineHeight: 19, color: color.ink2 }]} selectable>
                  {brief[2].trim()}
                </Text>
              </View>
            ) : null}
          </>
        ) : (
          <Markdown text={m.text} size={14.5} tint={color.ink2} />
        )}
        {t && !running && t.status !== "completed" && t.error ? <Text style={[type.meta, { marginTop: 2 }]}>{friendlyError(t.error, "The browser task didn't finish.")}</Text> : null}
        <Text style={[type.meta, { fontSize: 12, marginTop: 4 }]}>{timeLabel(m.createdAt)}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  headText: { flex: 1, fontFamily: font.body, fontSize: 12.5, color: color.ink2 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 14 },
  thumb: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  detailsToggle: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8, alignSelf: "flex-start" },
  code: { marginTop: 8, backgroundColor: color.paper, borderRadius: 14, padding: 12, maxHeight: 240 },
  codeText: { fontFamily: "Menlo", fontSize: 11.5, lineHeight: 17, color: color.ink2 },
  updateIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: color.tint, alignItems: "center", justifyContent: "center", marginTop: 1 },
});
