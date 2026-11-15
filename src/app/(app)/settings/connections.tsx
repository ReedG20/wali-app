import { useAction, useMutation, useQuery } from "convex/react";
import { Image } from "expo-image";
import { router, Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, RefreshControl, StyleSheet, Text, View } from "react-native";
import { api } from "../../../lib/convex-api";
import { PERMISSION_LABEL, type PermissionMode } from "../../../lib/permissions";
import type { Grant } from "../../../lib/types";
import { color, type } from "../../../theme";
import { Card, Empty, Icon, Lede, LoadError, Loading, Page, Pill, Row, SectionHead } from "../../../ui";
import { useReadAction, useTimedAction } from "../../../lib/useReadAction";
import { midSentence } from "../../../chat/Cards";
import { friendlyError } from "../../../lib/errors";

type Toolkit = { slug: string; name: string; logo: string | null; connected: boolean; status: string | null };
type State = {
  status: { model: boolean; composio: boolean; browserUse: boolean };
  toolkits: Toolkit[];
  /** Every connected app, including ones connected from a chat that aren't among the featured six. */
  connected?: { slug: string; name: string; logo: string | null; status: string | null }[];
  error: string | null;
  browserProfile: boolean;
};

const BLURB: Record<string, string> = {
  gmail: "Read, draft and send email.",
  googlecalendar: "See your day, find free time, hold time for you.",
  slack: "Catch up on threads and draft replies.",
  notion: "Find and add to your notes and docs.",
  todoist: "Turn promises into tasks.",
  github: "Issues and pull requests.",
};

const CALLBACK = "wali://connections";

/** What wali can reach. OAuth runs in the system sign-in sheet and comes straight back here. */
export default function Connections() {
  const load = useReadAction(api.agentNode.connections);
  const me = useQuery(api.users.me) as { permissions?: PermissionMode; alwaysAllow?: Grant[] } | null | undefined;
  const removeGrant = useMutation(api.users.removeAlwaysAllow);
  const connectApp = useTimedAction(api.agentNode.connectApp);
  const disconnectApp = useTimedAction(api.agentNode.disconnectApp);
  // Starting a cloud browser takes a while.
  const startSignIn = useTimedAction(api.agentNode.startBrowserSignIn, 60_000);
  const stopSignIn = useAction(api.agentNode.stopBrowserSignIn);
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A failed load is shown in the page with a way to retry. It used to be an alert, which could
  // arrive minutes later on top of a different screen.
  const refresh = useCallback(async () => {
    try {
      const next = (await load({})) as State;
      if (!alive.current) return;
      setState(next);
      setLoadError(null);
    } catch (e) {
      if (alive.current) setLoadError(friendlyError(e, "Connections didn't load. Try again."));
    }
  }, [load]);

  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener("change", (s) => s === "active" && void refresh());
    return () => sub.remove();
  }, [refresh]);

  async function toggle(t: Toolkit) {
    setBusy(t.slug);
    try {
      if (t.connected) {
        await disconnectApp({ toolkit: t.slug });
      } else {
        const res = (await connectApp({ toolkit: t.slug, callbackUrl: CALLBACK })) as { redirectUrl: string | null };
        if (res.redirectUrl) await WebBrowser.openAuthSessionAsync(res.redirectUrl, CALLBACK);
      }
      await refresh();
    } catch (e) {
      Alert.alert(t.connected ? "Couldn't disconnect" : "Couldn't start the connection", friendlyError(e, "Try again."));
    } finally {
      setBusy(null);
    }
  }

  async function signInBrowser() {
    setBusy("browser");
    try {
      const b = (await startSignIn({})) as { browserId: string; liveUrl: string | null };
      if (!b.liveUrl) throw new Error("The browser didn't start.");
      await WebBrowser.openBrowserAsync(b.liveUrl, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
      await stopSignIn({ browserId: b.browserId }).catch(() => {});
      Alert.alert("Saved", "wali's browser stays signed in.");
      await refresh();
    } catch (e) {
      Alert.alert("Couldn't start a browser", friendlyError(e, "Try again."));
    } finally {
      setBusy(null);
    }
  }

  const s = state?.status;
  // The featured apps, then anything else that's connected (an app wali connected from a chat):
  // without those, a connected app couldn't be seen or disconnected here.
  const apps: Toolkit[] = state
    ? [
        ...state.toolkits,
        ...(state.connected ?? []).filter((c) => !state.toolkits.some((k) => k.slug === c.slug)).map((c) => ({ ...c, connected: true })),
      ]
    : [];
  const grants = me?.alwaysAllow ?? [];

  function confirmRemove(g: Grant) {
    Alert.alert("Ask again?", `wali will ask before ${midSentence(g)} from now on.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Ask again",
        onPress: () => void removeGrant({ kind: g.kind, key: g.key }).catch((e) => Alert.alert("Couldn't change that", friendlyError(e, "Try again."))),
      },
    ]);
  }

  return (
    <>
      <Stack.Screen options={{ title: "Connections", headerLargeTitle: false }} />
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
        <Lede>wali works in the apps you connect. You choose how often it checks with you first.</Lede>
        <Card padded={false} style={{ marginBottom: 18 }}>
          <Row
            first
            icon="hand.raised"
            title="What wali can do"
            subtitle={PERMISSION_LABEL[me?.permissions ?? "balanced"]}
            onPress={() => router.push("/(app)/settings/permissions")}
          />
        </Card>

        {!state && loadError ? (
          <LoadError
            message={loadError}
            busy={retrying}
            onRetry={async () => {
              setRetrying(true);
              await refresh();
              if (alive.current) setRetrying(false);
            }}
          />
        ) : !state ? (
          <Loading fill={false} />
        ) : !s?.composio ? (
          <Empty>Connecting apps isn&apos;t set up for this account yet.</Empty>
        ) : state.error ? (
          <LoadError message="Your apps didn't load. Pull down to try again." />
        ) : (
          <View style={{ gap: 10 }}>
            {apps.map((t) => (
              <Card key={t.slug} style={st.app}>
                <View style={st.logo}>
                  {t.logo ? <Image source={{ uri: t.logo }} style={{ width: 24, height: 24 }} contentFit="contain" /> : <Text style={type.label}>{t.name[0]}</Text>}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Text style={type.label}>{t.name}</Text>
                    {t.connected ? <Icon name="checkmark.circle.fill" size={14} tint={color.ink2} /> : null}
                  </View>
                  <Text style={[type.meta, { marginTop: 1 }]} numberOfLines={2}>
                    {BLURB[t.slug] ?? (t.connected ? "Connected from a chat." : t.slug)}
                  </Text>
                </View>
                <Pill title={t.connected ? "Disconnect" : "Connect"} size="sm" kind={t.connected ? "secondary" : "primary"} busy={busy === t.slug} onPress={() => toggle(t)} />
              </Card>
            ))}
          </View>
        )}

        {grants.length > 0 ? (
          <>
            <SectionHead title="Always allowed" description="Things you told wali it can do without asking. Anything that sends, pays, deletes or changes something still asks." />
            <Card padded={false}>
              {grants.map((g, i) => (
                <View key={`${g.kind}:${g.key}`} style={[st.svc, i > 0 && st.line]}>
                  <Icon name={g.kind === "browser" ? "globe" : "square.grid.2x2"} size={16} />
                  <Text style={[type.bodySm, { flex: 1 }]} numberOfLines={2}>
                    {g.label}
                  </Text>
                  <Pill title="Ask again" size="sm" kind="secondary" onPress={() => confirmRemove(g)} />
                </View>
              ))}
            </Card>
          </>
        ) : null}

        <SectionHead title="wali's browser" description="For sites without an API, wali uses a cloud browser that keeps your sign-ins. Sign in to the sites you want it to use, once." />
        <Card style={st.app}>
          <View style={st.logo}>
            <Icon name="globe" size={20} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={type.label}>Signed-in browser</Text>
            <Text style={type.meta}>
              {!state ? (loadError ? "Couldn't check" : "Checking…") : state.browserProfile ? "Set up. Sign in to more sites any time." : "Set up the first time you use it"}
            </Text>
          </View>
          <Pill title="Sign in" size="sm" busy={busy === "browser"} disabled={!s?.browserUse} onPress={signInBrowser} />
        </Card>

        <SectionHead title="Services" />
        <Card padded={false}>
          {(
            [
              ["Replies", s?.model],
              ["Connected apps", s?.composio],
              ["Browser", s?.browserUse],
            ] as const
          ).map(([label, ok], i) => (
            <View key={label} style={[st.svc, i > 0 && st.line]}>
              <View style={[st.dot, { backgroundColor: ok ? color.ink : "rgba(154,149,139,0.4)" }]} />
              <Text style={[type.bodySm, { flex: 1 }]}>{label}</Text>
              <Text style={type.meta}>{ok === undefined ? (loadError ? "Couldn't check" : "Checking…") : ok ? "Ready" : "Not set up"}</Text>
            </View>
          ))}
        </Card>
      </Page>
    </>
  );
}

const st = StyleSheet.create({
  app: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  logo: { width: 44, height: 44, borderRadius: 14, borderCurve: "continuous", backgroundColor: color.paper, alignItems: "center", justifyContent: "center" },
  svc: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 13 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
