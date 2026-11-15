import { useMemo } from "react";
import { recentSegments, stateCounts } from "./db";
import { recorderStore } from "./recorder";
import { useStoreSelector } from "./store";

/** Local segment rows, re-read whenever the recorder/uploader reports a change. */
export function useLocalSegments(limit = 100) {
  const segmentsVersion = useStoreSelector(recorderStore, (s) => s.segmentsVersion);
  return useMemo(
    () => ({ rows: recentSegments(limit), counts: stateCounts() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segmentsVersion, limit],
  );
}
