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

// Bare URLs come before the emphasis patterns so underscores inside a link aren't read as italics.
const INLINE = /(\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>\[\]]+|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|(?<![A-Za-z0-9])_[^_\s][^_]*_(?![A-Za-z0-9]))/g;

const linkStyle: TextStyle = { textDecorationLine: "underline", textDecorationColor: "rgba(22,21,19,0.3)" };

/** "https://mail.google.com/mail/u/0/#inbox/FMfcgz…" -> "mail.google.com/mail/u/0…": long raw URLs wrapped mid-word. */
function shortUrl(url: string) {
  const bare = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  return bare.length > 38 ? `${bare.slice(0, 36)}…` : bare;
}

/**
 * Only web links are tappable, and they open in the in-app browser. This text comes from the
 * model and from web pages a browser task read, so a link must never be able to place a call,
 * write a text or open another app (tel:, sms:, mailto:, wali://, any custom scheme).
 */
const isWebLink = (url: string) => /^https?:\/\//i.test(url);
function openLink(url: string) {
  if (isWebLink(url)) void WebBrowser.openBrowserAsync(url).catch(() => {});
}

function inline(text: string, base: TextStyle): ReactNode[] {
  const parts = text.split(INLINE);
  return parts.map((p, i) => {
    if (!p) return null;
    if (/^(\*\*|__)/.test(p) && p.length > 4) return <Text key={i} style={{ fontFamily: font.semibold }}>{inline(p.slice(2, -2), base)}</Text>;
    if (/^`/.test(p)) return <Text key={i} style={{ fontFamily: "Menlo", fontSize: (base.fontSize ?? 16) * 0.86, backgroundColor: color.tint }}>{p.slice(1, -1)}</Text>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(p);
    if (link) {
      // Not a web link: show the words as plain text, with no link behaviour.
      if (!isWebLink(link[2])) return <Fragment key={i}>{link[1]}</Fragment>;
      return (
        <Text key={i} style={linkStyle} onPress={() => openLink(link[2])}>
          {link[1]}
        </Text>
      );
    }
    if (/^https?:\/\//.test(p)) {
      // Sentence punctuation right after a URL isn't part of it.
      // "(see https://x.com)." -> the ")" and "." close the sentence; "…/wiki/A_(b)" keeps its ")".
      let url = p;
      for (;;) {
        const last = url[url.length - 1];
        const closesNothing = last === ")" && url.split(")").length > url.split("(").length;
        if (!/[.,;:!?'"]/.test(last) && !closesNothing) break;
        url = url.slice(0, -1);
      }
      const trail = p.slice(url.length);
      return (
        <Fragment key={i}>
          <Text style={linkStyle} onPress={() => openLink(url)}>
            {shortUrl(url)}
          </Text>
          {trail}
        </Fragment>
      );
    }
    if (/^[*_]/.test(p) && p.length > 2) return <Text key={i} style={{ fontStyle: "italic" }}>{p.slice(1, -1)}</Text>;
    return <Fragment key={i}>{p.replace(/\*\*$/, "")}</Fragment>;
  });
}

export const Markdown = memo(function Markdown({ text, size = 16, tint = color.ink }: { text: string; size?: number; tint?: string }) {
  const base: TextStyle = { fontFamily: font.body, fontSize: size, lineHeight: Math.round(size * 1.58), color: tint };
  const blocks = parseBlocks(text);
  // Wide enough for the longest number in the message ("25."), so the period never wraps under it
  // and every item's text starts at the same place.
  const digits = Math.max(1, ...blocks.map((b) => (b.kind === "li" && b.ordered ? String(b.n).length : 1)));
  const numberWidth = Math.ceil(size * (0.62 * digits + 0.75));
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
              <Text numberOfLines={1} style={[base, { width: b.ordered ? numberWidth : 16, color: color.ink2, fontVariant: ["tabular-nums"] }]}>
                {b.ordered ? `${b.n}.` : "•"}
              </Text>
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
