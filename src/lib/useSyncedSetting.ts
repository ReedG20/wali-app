import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { friendlyError } from "./errors";

/**
 * A setting that lives on the server and is edited here (quiet hours, notification switches, the
 * permission mode).
 *
 * - The screen shows the server's value, not a copy taken when it opened: that copy went stale
 *   when the setting changed elsewhere or a save never landed, so the page could show one
 *   quiet-hours window while wali used another.
 * - While an edit is being saved, the edit is what's shown.
 * - Saves go out one at a time and the latest edit wins: edits made while a save is in flight
 *   are sent as one save when it finishes. So two quick edits can never leave the server holding
 *   a value the screen said had failed.
 * - If the last save fails, the screen goes back to what the server has and says so once.
 */
export function useSyncedSetting<T>(server: T | undefined | null, save: (value: T) => Promise<unknown>) {
  const [draft, setDraft] = useState<{ value: T } | null>(null);
  const state = useRef<{ saving: boolean; queued: { value: T } | null }>({ saving: false, queued: null });
  // Always call the latest `save` (callers may pass a new function each render).
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const flush = useCallback(async () => {
    const st = state.current;
    if (st.saving) return;
    st.saving = true;
    let failure: unknown = null;
    try {
      while (st.queued) {
        const next = st.queued;
        st.queued = null;
        try {
          await saveRef.current(next.value);
          failure = null;
        } catch (e) {
          // A newer edit is waiting: it carries the whole value, so this failure may not matter.
          failure = e;
        }
      }
    } finally {
      st.saving = false;
    }
    if (!alive.current) return;
    // Convex delivers the updated query result before the mutation resolves, so `server` already
    // holds the saved value: drop the draft and show the server again.
    setDraft(null);
    if (failure) Alert.alert("Couldn't save", friendlyError(failure, "Try again."));
  }, []);

  const set = useCallback(
    (value: T) => {
      setDraft({ value });
      state.current.queued = { value };
      void flush();
    },
    [flush],
  );

  const value: T | null = draft ? draft.value : (server ?? null);
  return [value, set] as const;
}
