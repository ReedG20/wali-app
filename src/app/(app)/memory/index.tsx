import { useQuery } from "convex/react";
import { Stack } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, RefreshControl, StyleSheet, Text, View } from "react-native";
import { api } from "../../../lib/convex-api";
import { friendlyError } from "../../../lib/errors";
import { ago, dayLabel, formatDate, splitDatePrefix, timeLabel } from "../../../lib/time";
import { useReadAction, useTimedAction } from "../../../lib/useReadAction";
import { largeTitle } from "../../../navigation";
import { color, type } from "../../../theme";
import { Card, Empty, Lede, LoadError, Loading, Page, SectionHead, Skeleton } from "../../../ui";

type Overview = {
  enabled: boolean;
  profile: { static: string[]; dynamic: string[] } | null;
  backfilledAt: number | null;
  documents: number | null;
  error: string | null;
};
type Hit = { text: string; similarity: number; date: string | null; kind: string | null };
type Note = { _id: string; text: string; createdAt: number };

/** What wali knows: lasting facts, recent context, search, and the notes wali saved. */
export default function Memory() {
  const loadOverview = useReadAction(api.agentNode.memoryOverview);
  const searchMemory = useReadAction(api.agentNode.memorySearch);
  const syncNow = useTimedAction(api.agentNode.syncMemoryNow);
  const notes = useQuery(api.activity.notes) as Note[] | undefined;

  const [overview, setOverview] = useState<Overview | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const searchSeq = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Errors stay on this page. An alert here used to pop up over whatever screen you'd moved on to.
  const refresh = useCallback(async () => {
    try {
      const next = (await loadOverview({})) as Overview;
      if (!alive.current) return;
      setOverview(next);
      setLoadError(null);
    } catch (e) {
      if (alive.current) setLoadError(friendlyError(e, "Memory didn't load. Try again."));
    }
  }, [loadOverview]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function search(q: string) {
    if (!q.trim()) return setHits(null);
    const seq = ++searchSeq.current;
    setSearching(true);
    setSearchError(null);
    try {
      const res = (await searchMemory({ query: q })) as Hit[];
      if (seq === searchSeq.current && alive.current) setHits(res);
    } catch (e) {
      if (seq === searchSeq.current && alive.current) setSearchError(friendlyError(e, "The search didn't go through. Try again."));
    } finally {
      if (seq === searchSeq.current && alive.current) setSearching(false);
    }
  }

  const p = overview?.profile;
  const showingSearch = query.trim().length > 0;

  return (
    <>
      <Stack.Screen options={{ ...largeTitle, title: "Memory" }} />
      <Stack.SearchBar
        placeholder="Who is Sam? What did I promise?"
        onChangeText={(e) => {
          setQuery(e.nativeEvent.text);
          if (!e.nativeEvent.text) setHits(null);
        }}
        onSearchButtonPress={(e) => void search(e.nativeEvent.text)}
        onCancelButtonPress={() => {
          setQuery("");
          setHits(null);
        }}
      />
      <Page
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await refresh();
              setRefreshing(false);
            }}
          />
        }
      >
        {showingSearch ? (
          <View style={{ gap: 10, paddingTop: 8 }}>
            {searching ? (
              <Loading fill={false} />
            ) : searchError ? (
              <LoadError message={searchError} onRetry={() => void search(query)} />
            ) : hits === null ? (
              <Text style={type.meta}>Search the same memory wali reads. Tap Search on the keyboard.</Text>
            ) : hits.length === 0 ? (
              <Text style={type.secondary}>Nothing relevant found.</Text>
            ) : (
              hits.map((h, i) => (
                <Card key={i} style={{ padding: 16 }}>
                  <Text style={type.bodySm} selectable>
                    {splitDatePrefix(h.text).text}
                  </Text>
                  <Text style={[type.meta, { marginTop: 6, fontSize: 12 }]}>
                    {Math.round(h.similarity * 100)}% match
                    {h.date ? ` · ${formatDate(new Date(h.date), { month: "short", day: "numeric" })}` : ""}
                  </Text>
                </Card>
              ))
            )}
          </View>
        ) : (
          <>
            <Lede>Every conversation the pendant hears goes into memory. wali reads it before every reply and every nudge.</Lede>
            {loadError && !overview ? (
              <LoadError
                message={loadError}
                busy={retrying}
                onRetry={async () => {
                  setRetrying(true);
                  await refresh();
                  if (alive.current) setRetrying(false);
                }}
              />
            ) : overview && !overview.enabled ? (
              <Empty>Long-term memory isn&apos;t turned on for this account yet.</Empty>
            ) : overview && !overview.profile && overview.error ? (
              // The profile couldn't be fetched: say so, rather than showing empty lists as if
              // wali knew nothing.
              <LoadError
                message={`Memory couldn't be read just now: ${friendlyError(overview.error, "unknown problem")}`}
                busy={retrying}
                onRetry={async () => {
                  setRetrying(true);
                  await refresh();
                  if (alive.current) setRetrying(false);
                }}
              />
            ) : (
              <>
                <SectionHead title="About you" description="Lasting facts, learned from your conversations." />
                <FactList items={p?.static} loading={!overview} empty="Nothing lasting yet. These build up over days of conversations, so the first ones can take a while to appear." />
                <SectionHead title="Lately" description="Recent context. Older items fade on their own." />
                <FactList items={p?.dynamic} loading={!overview} empty="No recent context yet." />
              </>
            )}

            <SectionHead title="Notes wali saved" description="Things wali chose to remember." />
            {!notes ? (
              <Skeleton height={64} style={{ borderRadius: 22 }} />
            ) : notes.length === 0 ? (
              <Empty>No notes yet.</Empty>
            ) : (
              <Card padded={false}>
                {notes.map((n, i) => (
                  <View key={n._id} style={[s.item, i > 0 && s.line]}>
                    <Text style={type.bodySm} selectable>
                      {splitDatePrefix(n.text).text}
                    </Text>
                    <Text style={[type.meta, { marginTop: 2, fontSize: 12.5 }]}>{timeLabel(n.createdAt)}</Text>
                  </View>
                ))}
              </Card>
            )}

            {overview?.enabled ? (
              <Text style={[type.meta, { marginTop: 28 }]}>
                {overview.backfilledAt
                  ? `Pendant history synced ${ago(overview.backfilledAt)}${overview.documents ? ` (${overview.documents} items)` : ""}. New conversations sync as they're transcribed. `
                  : "Pendant history hasn't been synced yet. "}
                <Text
                  style={{ color: color.ink2, textDecorationLine: "underline" }}
                  onPress={async () => {
                    try {
                      await syncNow({});
                      Alert.alert("Syncing", "Your pendant history is going into memory.");
                    } catch (e) {
                      Alert.alert("Couldn't start the sync", friendlyError(e, "Try again."));
                    }
                  }}
                >
                  Sync again
                </Text>
              </Text>
            ) : null}
          </>
        )}
      </Page>
    </>
  );
}

function FactList({ items, loading, empty }: { items?: string[]; loading: boolean; empty: string }) {
  if (loading)
    return (
      <Card style={{ gap: 12 }}>
        <Skeleton width="70%" />
        <Skeleton width="50%" />
        <Skeleton width="60%" />
      </Card>
    );
  if (!items?.length) return <Empty>{empty}</Empty>;
  return (
    <Card padded={false}>
      {items.map((m, i) => {
        // "[2026-11-15] They plan…" -> the sentence, with the day underneath instead of raw brackets.
        const { text, date } = splitDatePrefix(m);
        return (
          <View key={i} style={[s.item, i > 0 && s.line]}>
            <Text style={type.bodySm} selectable>
              {text}
            </Text>
            {date ? <Text style={[type.meta, { marginTop: 2, fontSize: 12.5 }]}>{dayLabel(date)}</Text> : null}
          </View>
        );
      })}
    </Card>
  );
}

const s = StyleSheet.create({
  item: { paddingHorizontal: 18, paddingVertical: 13 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
});
