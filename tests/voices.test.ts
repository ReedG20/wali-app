// Naming voices: who the picker offers, where "It's Ife" goes, and what people read.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  heard,
  longestLine,
  namedMessage,
  personChoices,
  pickerTitle,
  quote,
  sameAsName,
  sameAsTarget,
  typedName,
  type KnownPerson,
  type Person,
  type Voice,
} from "../src/lib/voices.ts";

const id = <T extends string>(s: string) => s as unknown as import("convex/values").GenericId<T>;

const reed: KnownPerson = { _id: id("p_reed"), name: "Reed", isMe: true };
const ife: KnownPerson = { _id: id("p_ife"), name: "Ife", isMe: false };
const mom: KnownPerson = { _id: id("p_mom"), name: "Mom", isMe: false };

function voice(over: Partial<Voice> = {}): Voice {
  return {
    _id: id("v_new"),
    recordingCount: 3,
    totalSeconds: 40,
    firstHeardAt: 0,
    lastHeardAt: 0,
    clipUrl: null,
    sampleText: null,
    nameSuggestion: null,
    maybeSameAs: null,
    ...over,
  };
}

function person(p: KnownPerson, voiceIds: string[]): Person {
  return { ...p, recordingCount: 1, lastHeardAt: null, voices: voiceIds.map((v) => voice({ _id: id(v) })) };
}

test("the picker offers That's me first, then everyone else, never the wearer by name", () => {
  const choices = personChoices([mom, reed, ife]);
  assert.deepEqual(
    choices.map((c) => c.label),
    ["That's me", "Mom", "Ife"],
  );
  assert.deepEqual(choices[0].target, { me: true });
  assert.deepEqual(choices[1].target, { personId: mom._id });
});

test("the person a speaker is already named as isn't offered again", () => {
  assert.deepEqual(
    personChoices([reed, ife, mom], { currentPersonId: ife._id }).map((c) => c.label),
    ["That's me", "Mom"],
  );
  // Already the wearer: "That's me" would change nothing.
  assert.deepEqual(
    personChoices([reed, ife], { currentPersonId: reed._id }).map((c) => c.label),
    ["Ife"],
  );
});

test("That's me can be left out, and works before anyone is named", () => {
  assert.deepEqual(personChoices([ife], { allowMe: false }).map((c) => c.label), ["Ife"]);
  assert.deepEqual(personChoices([]).map((c) => c.label), ["That's me"]);
});

test("typed names are cleaned like the server cleans them", () => {
  assert.equal(typedName("  Aunt   Jo \n"), "Aunt Jo");
  assert.equal(typedName("   "), null);
  assert.equal(typedName(undefined), null);
  assert.equal(typedName("x".repeat(80))?.length, 60);
});

test("Sounds like Ife goes to the person who owns that voice", () => {
  const people = [person(reed, ["v_reed"]), person(ife, ["v_ife1", "v_ife2"])];
  const dup = voice({ maybeSameAs: { voiceId: id("v_ife2"), name: "Ife" } });
  assert.deepEqual(sameAsTarget(dup, people), { personId: ife._id });
  assert.equal(sameAsName(dup, people), "Ife");
});

test("Sounds like falls back to the name, and is hidden when the other voice isn't named", () => {
  const byName = voice({ maybeSameAs: { voiceId: id("v_gone"), name: "Ife" } });
  assert.deepEqual(sameAsTarget(byName, []), { name: "Ife" });
  assert.equal(sameAsName(byName, []), "Ife");

  const unnamed = voice({ maybeSameAs: { voiceId: id("v_other"), name: null } });
  assert.equal(sameAsTarget(unnamed, []), null);
  assert.equal(sameAsName(unnamed, []), null);
  assert.equal(sameAsTarget(voice(), []), null);
});

test("how often a voice was heard reads plainly", () => {
  const ago = () => "2 hr ago";
  assert.equal(heard({ recordingCount: 1, lastHeardAt: 5 }, ago), "1 conversation · last 2 hr ago");
  assert.equal(heard({ recordingCount: 12, lastHeardAt: null }, ago), "12 conversations");
});

test("the longest line a speaker said reminds you who they were", () => {
  const utts = [
    { speakerRaw: "speaker_0", text: "Hi." },
    { speakerRaw: "speaker_1", text: "Let's meet at 9:30 and rehearse it once." },
    { speakerRaw: "speaker_0", text: "Sounds good to me." },
  ];
  assert.equal(longestLine(utts, "speaker_0"), "Sounds good to me.");
  assert.equal(longestLine(utts, "speaker_9"), null);
});

test("quotes are trimmed at a word", () => {
  assert.equal(quote("  short  one "), "“short one”");
  const long = quote("one two three four five six seven eight nine ten", 20);
  assert.equal(long, "“one two three four…”");
});

test("picker titles and confirmations", () => {
  assert.equal(pickerTitle("Speaker 2", false), "Who's Speaker 2?");
  assert.equal(pickerTitle("Ife", true), "Not Ife?");
  assert.equal(namedMessage("recording"), "Saved for this conversation.");
  assert.match(namedMessage("voice"), /recognize them/);
  assert.match(namedMessage("corrected"), /recognize them/);
});
