import { useAction, useQuery } from "convex/react";
import { Stack } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, RefreshControl, StyleSheet, Text, View } from "react-native";
import { api } from "../../../lib/convex-api";
import { ago, formatDate, timeLabel } from "../../../lib/time";
import { useReadAction } from "../../../lib/useReadAction";
import { largeTitle } from "../../../navigation";
import { color, type } from "../../../theme";
import { Card, Empty, Lede, Page, SectionHead, Skeleton, Spinner } from "../../../ui";

type Overview = {
  enabled: boolean;
  profile: { static: string[]; dynamic: string[] } | null;
  backfilledAt: number | null;
  documents: number | null;
  error: string | null;
};
type Hit = { text: string; similarity: number; date: string | null; kind: string | null };
type Note = { _id: string; text: string; createdAt: number };

/** What wali knows: the Supermemory profile, recent context, search, and the notes wali saved. */
export default function Memory() {
  const loadOverview = useReadAction(api.agentNode.memoryOverview);
  const searchMemory = useReadAction(api.agentNode.memorySearch);
  const syncNow = useAction(api.agentNode.syncMemoryNow);
  const notes = useQuery(api.activity.notes) as Note[] | undefined;

  const [overview, setOverview] = useState<Overview | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  const refresh = useCallback(async () => {
    try {
      setOverview((await loadOverview({})) as Overview);
    } catch (e) {
      Alert.alert("Couldn't load memory", e instanceof Error ? e.message.split("\n")[0] : "Try again.");
    }
  }, [loadOverview]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function search(q: string) {
    if (!q.trim()) return setHits(null);
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const res = (await searchMemory({ query: q })) as Hit[];
      if (seq === searchSeq.current) setHits(res);
    } finally {
      if (seq === searchSeq.current) setSearching(false);
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
              <View style={{ paddingTop: 20 }}>
                <Spinner />
              </View>
            ) : hits === null ? (
              <Text style={type.meta}>Search the same memory wali reads. Tap Search on the keyboard.</Text>
            ) : hits.length === 0 ? (
              <Text style={type.secondary}>Nothing relevant found.</Text>
            ) : (
              hits.map((h, i) => (
                <Card key={i} style={{ padding: 16 }}>
                  <Text style={type.bodySm} selectable>
                    {h.text}
                  </Text>
                  <Text style={[type.meta, { marginTop: 6, fontSize: 12 }]}>
                    {Math.round(h.similarity * 100)}% match
                    {h.date ? ` · ${formatDate(new Date(h.date), { month: "short", day: "numeric" })}` : ""}
                    {h.kind ? ` · ${h.kind}` : ""}
                  </Text>
                </Card>
              ))
            )}
          </View>
        ) : (
          <>
            <Lede>Every conversation the pendant hears goes into memory. wali reads it before every reply and every nudge.</Lede>
            {overview && !overview.enabled ? (
              <Empty>Long-term memory is off. Add SUPERMEMORY_API_KEY in Convex to turn it on.</Empty>
            ) : (
              <>
                <SectionHead title="About you" description="Lasting facts, learned from your conversations." />
                <FactList items={p?.static} loading={!overview} empty="Nothing yet. Memory is still reading your conversations; check back in a minute." />
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
                    <Text style={type.bodySm}>{n.text}</Text>
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
                    await syncNow({});
                    Alert.alert("Syncing", "Your pendant history is going into memory.");
                  }}
                >
                  Sync again
                </Text>
                {overview.error ? ` · ${overview.error}` : ""}
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
      {items.map((m, i) => (
        <Text key={i} style={[type.bodySm, s.item, i > 0 && s.line]} selectable>
          {m}
        </Text>
      ))}
    </Card>
  );
}

const s = StyleSheet.create({
  item: { paddingHorizontal: 18, paddingVertical: 13 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
});
