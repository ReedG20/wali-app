import * as WebBrowser from "expo-web-browser";
import type { SFSymbol } from "expo-symbols";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ToolPart } from "../lib/types";
import { color, font } from "../theme";
import { Icon, Pill, Spinner } from "../ui";

const LABELS: Record<string, { icon: SFSymbol; running: string; done: string }> = {
  search_memory: { icon: "magnifyingglass", running: "Searching your conversations", done: "Searched your conversations" },
  search_transcripts: { icon: "text.magnifyingglass", running: "Searching transcripts", done: "Searched transcripts" },
  recent_conversations: { icon: "text.bubble", running: "Reading recent conversations", done: "Read recent conversations" },
  save_note: { icon: "note.text", running: "Saving a note", done: "Saved a note" },
  schedule_followup: { icon: "clock", running: "Scheduling a follow-up", done: "Scheduled a follow-up" },
  find_app_actions: { icon: "magnifyingglass", running: "Looking through your apps", done: "Looked through your apps" },
  run_app_action: { icon: "calendar", running: "Using your apps", done: "Used your apps" },
  connect_app: { icon: "link", running: "Preparing a connect link", done: "Connect link ready" },
  browser_task: { icon: "globe", running: "Starting the browser", done: "Browser task" },
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function detail(tool: ToolPart) {
  const args = asRecord(tool.args);
  const res = asRecord(tool.result);
  if (tool.toolName === "run_app_action") {
    const slug = String(args?.toolSlug ?? "");
    return res?.status === "awaiting_approval" ? `${slug} · waiting for your OK` : slug;
  }
  if (tool.toolName === "search_memory") return args?.query ? `“${String(args.query)}”` : "";
  if (tool.toolName === "schedule_followup") return res?.scheduledFor ? `for ${String(res.scheduledFor)}` : "";
  if (tool.toolName === "browser_task" && res?.status === "awaiting_approval") return "waiting for your OK";
  return "";
}

/** A quiet, expandable row for each tool wali used. */
export function ToolCall({ tool }: { tool: ToolPart }) {
  const [open, setOpen] = useState(false);
  const meta = LABELS[tool.toolName] ?? { icon: "wrench.and.screwdriver" as SFSymbol, running: tool.toolName, done: tool.toolName };
  const res = asRecord(tool.result);
  const connectUrl = tool.toolName === "connect_app" && typeof res?.connectUrl === "string" && /^https:\/\//i.test(res.connectUrl) ? res.connectUrl : null;
  const d = detail(tool);

  return (
    <View style={{ marginVertical: 3, alignItems: "flex-start" }}>
      <Pressable onPress={() => setOpen((o) => !o)} style={({ pressed }) => [s.chip, pressed && { backgroundColor: color.tintStrong }]}>
        {tool.state === "running" ? (
          <Spinner />
        ) : (
          <Icon name={tool.state === "error" ? "exclamationmark.circle" : meta.icon} size={14} tint={tool.state === "error" ? color.ink3 : color.ink2} />
        )}
        <Text style={s.chipText} numberOfLines={1}>
          {tool.state === "running" ? meta.running : meta.done}
          {d ? <Text style={{ color: color.ink3 }}> · {d}</Text> : null}
        </Text>
        <Icon name={open ? "chevron.up" : "chevron.down"} size={10} tint={color.ink3} />
      </Pressable>
      {open ? (
        <View style={s.code}>
          <Text style={s.codeText} selectable>
            {JSON.stringify({ input: tool.args, output: tool.result }, null, 2)}
          </Text>
        </View>
      ) : null}
      {connectUrl ? (
        <Pill
          title={`Connect ${String(res?.toolkit ?? "app")}`}
          icon="checkmark"
          size="sm"
          style={{ marginTop: 8 }}
          onPress={() => void WebBrowser.openAuthSessionAsync(connectUrl, "wali://connections").catch(() => {})}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    maxWidth: "100%",
    paddingVertical: 7,
    paddingLeft: 10,
    paddingRight: 12,
    borderRadius: 999,
    backgroundColor: color.tint,
  },
  chipText: { flexShrink: 1, fontFamily: font.body, fontSize: 13, color: color.ink2 },
  code: { marginTop: 8, alignSelf: "stretch", backgroundColor: "rgba(255,255,255,0.8)", borderRadius: 14, padding: 12, maxHeight: 260 },
  codeText: { fontFamily: "Menlo", fontSize: 11.5, lineHeight: 17, color: color.ink2 },
});
