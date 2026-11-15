// Talks to the Mind Convex backend (separate repo) through anyApi plus hand-written types,
// so this app never imports the backend's generated code.
import { ConvexHttpClient } from "convex/browser";
import { ConvexReactClient } from "convex/react";
import { anyApi } from "convex/server";
import type { DefaultFunctionArgs, FunctionReference } from "convex/server";

export const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL ?? "";

export const convex = new ConvexReactClient(CONVEX_URL || "https://missing-convex-url.invalid", {
  unsavedChangesWarning: false,
  // Clerk's Convex tokens live 60 s. Start refreshing 20 s before expiry (default 10) so a slow
  // token fetch on a weak connection doesn't let the token lapse: when it does, the client stops
  // the socket to re-authenticate and every in-flight action fails with "Connection lost".
  authRefreshTokenLeewaySeconds: 20,
});

/**
 * Plain HTTPS client for the uploader: one request per call, no WebSocket to keep alive. iOS may
 * drop the React client's socket while the app is suspended in the background; fetch works
 * whenever the app gets execution time (e.g. woken by a BLE notification).
 */
export const convexHttp = new ConvexHttpClient(CONVEX_URL || "https://missing-convex-url.invalid");

export type RecordingStatus = "pending" | "transcribing" | "done" | "empty" | "failed";

export type SpeakerStat = {
  speakerRaw: string;
  label: string;
  seconds: number;
};

export type Recording = {
  _id: string;
  _creationTime: number;
  clientId: string;
  storageId: string;
  boot: number;
  seqStart: number;
  seqEnd: number;
  startedAt: number;
  timeApprox?: boolean;
  durationMs: number;
  backfill: boolean;
  status: RecordingStatus;
  attempts: number;
  error?: string;
  languageCode?: string;
  speakers?: SpeakerStat[];
  utteranceCount?: number;
  preview?: string;
  createdAt: number;
  transcribedAt?: number;
};

export type Utterance = {
  _id: string;
  recordingId: string;
  startAt: number;
  endAt: number;
  speakerRaw: string;
  speakerLabel: string;
  text: string;
};

type Q<Args extends DefaultFunctionArgs, Ret> = FunctionReference<"query", "public", Args, Ret>;
type M<Args extends DefaultFunctionArgs, Ret> = FunctionReference<"mutation", "public", Args, Ret>;

export type CreateRecordingArgs = {
  clientId: string;
  storageId: string;
  boot: number;
  seqStart: number;
  seqEnd: number;
  startedAt: number;
  timeApprox?: boolean;
  durationMs: number;
  levels: ArrayBuffer;
  backfill: boolean;
};

/** Typed view of the backend functions this app uses. Keep in sync with backend/convex/. */
export const api = anyApi as unknown as {
  recordings: {
    generateUploadUrl: M<Record<string, never>, string>;
    create: M<CreateRecordingArgs, { id: string; created: boolean }>;
    retry: M<{ id: string }, null>;
    list: Q<{ limit?: number }, Recording[]>;
    get: Q<{ id: string }, (Recording & { audioUrl: string | null }) | null>;
  };
  utterances: {
    forRecording: Q<{ recordingId: string }, Utterance[]>;
    recent: Q<{ limit?: number }, Utterance[]>;
  };
};
