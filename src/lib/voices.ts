// Who's speaking: the shapes the backend's voices functions return, and the small decisions the
// Voices screen and the transcript's "Who's this?" picker make about them. No React or native
// imports, so the tests can run it directly.
import type { GenericId as Id } from "convex/values";

/** Who a name goes to: someone already known, a (new or existing) name, or the wearer. */
export type Target = { personId?: Id<"people">; name?: string; me?: boolean };

export type Voice = {
  _id: Id<"voices">;
  recordingCount: number;
  totalSeconds: number;
  firstHeardAt: number;
  lastHeardAt: number;
  clipUrl: string | null;
  sampleText: string | null;
  nameSuggestion: { name: string; evidence: string } | null;
  maybeSameAs: { voiceId: Id<"voices">; name: string | null } | null;
};

export type Person = {
  _id: Id<"people">;
  name: string;
  isMe: boolean;
  recordingCount: number;
  lastHeardAt: number | null;
  voices: Voice[];
};

/** voices.overview: everything the Voices screen shows (null when signed out). */
export type Overview = {
  meSuggestion: Voice | null;
  people: Person[];
  unnamed: Voice[];
  oneOffCount: number;
  background: Voice[];
  recordingsProcessed: number;
};

/** voices.people: the short list the picker offers. */
export type KnownPerson = { _id: Id<"people">; name: string; isMe: boolean };

/** What voices.nameSpeaker did: named the voice everywhere, fixed one mismatched recording, or labelled just this one. */
export type NameScope = "voice" | "corrected" | "recording";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "12 conversations · last 3 hr ago" */
export function heard(v: { recordingCount: number; lastHeardAt: number | null }, ago: (ms: number) => string): string {
  return `${plural(v.recordingCount, "conversation")}${v.lastHeardAt ? ` · last ${ago(v.lastHeardAt)}` : ""}`;
}

export type Choice = { label: string; target: Target };

/**
 * The people a voice could belong to, in picker order: "That's me" first, then everyone else
 * known. The person it's already named as is left out (picking them would change nothing), and
 * so is "That's me" when it already is the wearer.
 */
export function personChoices(people: KnownPerson[], opts: { currentPersonId?: string | null; allowMe?: boolean } = {}): Choice[] {
  const current = opts.currentPersonId ?? null;
  const me = people.find((p) => p.isMe);
  const out: Choice[] = [];
  if (opts.allowMe !== false && !(me && me._id === current)) out.push({ label: "That's me", target: { me: true } });
  for (const p of people) {
    if (p.isMe || p._id === current) continue;
    out.push({ label: p.name, target: { personId: p._id } });
  }
  return out;
}

/** A typed name, cleaned the way the server cleans it. Null when there's nothing left. */
export function typedName(raw: string | null | undefined): string | null {
  const name = (raw ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  return name || null;
}

/**
 * "Sounds like Ife → It's Ife": the person a probable duplicate voice should go to. Prefer the
 * person who owns the voice it sounds like (so it can't land on a new namesake), else their name.
 */
export function sameAsTarget(voice: Voice, people: Person[]): Target | null {
  const like = voice.maybeSameAs;
  if (!like) return null;
  const owner = people.find((p) => p.voices.some((v) => v._id === like.voiceId));
  if (owner) return { personId: owner._id };
  return like.name ? { name: like.name } : null;
}

/** Display name for a "sounds like" hint, or null when the voice it resembles isn't named. */
export function sameAsName(voice: Voice, people: Person[]): string | null {
  const like = voice.maybeSameAs;
  if (!like) return null;
  return people.find((p) => p.voices.some((v) => v._id === like.voiceId))?.name ?? like.name;
}

type Spoken = { speakerRaw: string; text: string };

/** The longest thing a speaker said in a recording, to remind you who they were. */
export function longestLine(utterances: Spoken[], speakerRaw: string): string | null {
  let best: string | null = null;
  for (const u of utterances) if (u.speakerRaw === speakerRaw && u.text.length > (best?.length ?? 0)) best = u.text;
  return best;
}

/** “A short quote” for a picker message, cut at a word near `max` characters. */
export function quote(text: string, max = 140): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return `“${t}”`;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `“${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…”`;
}

/** One line under the picker's title: what naming this speaker will change. */
export function scopeHint(hasVoice: boolean): string {
  return hasVoice
    ? "wali will use this name for this voice in every conversation, including past ones."
    : "This speaker said too little for wali to learn their voice, so the name applies to this conversation only.";
}

/** "Not Ife?" when the speaker already has a name, "Who's Speaker 2?" when not. */
export function pickerTitle(label: string, named: boolean): string {
  return named ? `Not ${label}?` : `Who's ${label}?`;
}

/** What to tell someone after naming a speaker from a transcript. */
export function namedMessage(scope: NameScope): string {
  return scope === "recording" ? "Saved for this conversation." : "Saved. wali will recognize them from now on.";
}
