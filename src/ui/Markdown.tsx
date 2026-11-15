// A small markdown renderer for wali's replies: paragraphs, headings, bullet/numbered lists,
// code blocks, and inline bold / italic / code / links. Tolerates half-streamed input.
import * as WebBrowser from "expo-web-browser";
import { Fragment, memo, type ReactNode } from "react";
import { Text, View, type TextStyle } from "react-native";
import { color, font } from "../theme";

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: number; text: string }
  | { kind: "li"; ordered: boolean; n: number; depth: number; text: string }
  | { kind: "code"; text: string }
  | { kind: "quote"; text: string };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r/g, "").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      out.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    const q = /^>\s?(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (h) {
      flush();
      out.push({ kind: "h", level: h[1].length, text: h[2] });
    } else if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      out.push({ kind: "li", ordered, n: ordered ? parseInt(li[2], 10) : 0, depth: Math.floor(li[1].length / 2), text: li[3] });
    } else if (q) {
      flush();
      out.push({ kind: "quote", text: q[1] });
    } else if (out.length && out[out.length - 1].kind === "li" && /^\s{2,}\S/.test(line) && !para.length) {
      (out[out.length - 1] as { text: string }).text += ` ${line.trim()}`;
    } else para.push(line.trim());
  }
  flush();
  return out;
}

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, base: TextStyle): ReactNode[] {
  const parts = text.split(INLINE);
  return parts.map((p, i) => {
    if (!p) return null;
    if (/^(\*\*|__)/.test(p) && p.length > 4) return <Text key={i} style={{ fontFamily: font.semibold }}>{inline(p.slice(2, -2), base)}</Text>;
    if (/^`/.test(p)) return <Text key={i} style={{ fontFamily: "Menlo", fontSize: (base.fontSize ?? 16) * 0.86, backgroundColor: color.tint }}>{p.slice(1, -1)}</Text>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(p);
    if (link)
      return (
        <Text key={i} style={{ textDecorationLine: "underline", textDecorationColor: "rgba(22,21,19,0.3)" }} onPress={() => void WebBrowser.openBrowserAsync(link[2])}>
          {link[1]}
        </Text>
      );
    if (/^[*_]/.test(p) && p.length > 2) return <Text key={i} style={{ fontStyle: "italic" }}>{p.slice(1, -1)}</Text>;
    return <Fragment key={i}>{p.replace(/\*\*$/, "")}</Fragment>;
  });
}

export const Markdown = memo(function Markdown({ text, size = 16 }: { text: string; size?: number }) {
  const base: TextStyle = { fontFamily: font.body, fontSize: size, lineHeight: Math.round(size * 1.58), color: color.ink };
  const blocks = parseBlocks(text);
  return (
    <View style={{ gap: 10 }}>
      {blocks.map((b, i) => {
        if (b.kind === "h")
          return (
            <Text key={i} style={[base, { fontFamily: font.semibold, fontSize: size + (b.level <= 2 ? 2 : 0), marginTop: i ? 4 : 0 }]}>
              {inline(b.text, base)}
            </Text>
          );
        if (b.kind === "li")
          return (
            <View key={i} style={{ flexDirection: "row", paddingLeft: b.depth * 16, marginTop: -4 }}>
              <Text style={[base, { width: b.ordered ? 22 : 16, color: color.ink2 }]}>{b.ordered ? `${b.n}.` : "•"}</Text>
              <Text style={[base, { flex: 1 }]} selectable>
                {inline(b.text, base)}
              </Text>
            </View>
          );
        if (b.kind === "code")
          return (
            <View key={i} style={{ backgroundColor: color.tint, borderRadius: 14, padding: 12 }}>
              <Text style={{ fontFamily: "Menlo", fontSize: 12.5, lineHeight: 18, color: color.ink2 }} selectable>
                {b.text}
              </Text>
            </View>
          );
        if (b.kind === "quote")
          return (
            <Text key={i} style={[base, { color: color.ink2, paddingLeft: 12 }]}>
              {inline(b.text, base)}
            </Text>
          );
        return (
          <Text key={i} style={base} selectable>
            {inline(b.text, base)}
          </Text>
        );
      })}
    </View>
  );
});
