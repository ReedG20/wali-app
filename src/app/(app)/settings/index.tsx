import { useClerk, useUser } from "@clerk/expo";
import { useMutation, useQuery } from "convex/react";
import { Image } from "expo-image";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { ActionSheetIOS, Alert, StyleSheet, Switch, Text, View } from "react-native";
import { EmberDot } from "../../../brand";
import { bleStore, connect, disconnect, scan, setMuted } from "../../../lib/ble";
import { api } from "../../../lib/convex-api";
import { friendlyError } from "../../../lib/errors";
import { forgetPushToken } from "../../../lib/notifications";
import { pendantName } from "../../../lib/pendantName";
import { PERMISSION_LABEL, type PermissionMode } from "../../../lib/permissions";
import { useStore } from "../../../lib/store";
import { ago, storage } from "../../../lib/time";
import { largeTitle } from "../../../navigation";
import { color, display, font, type } from "../../../theme";
import { Card, Icon, Lede, Page, Pill, Row, SectionHead } from "../../../ui";

type Device = { _id: string; name: string; status: "connected" | "disconnected"; connectedAt: number };
type Stream = { lastStartedAt: number; lastEndedAt: number; lastStatus: string; lastPreview: string | null } | null;

/** The pendant: Bluetooth link on this phone, the account's pendant stream, and everything around it. */
export default function PendantTab() {
  const ble = useStore(bleStore);
  const devices = (useQuery(api.devices.mine) ?? []) as Device[];
  const stream = useQuery(api.devices.stream) as Stream | undefined;
  const linkAccount = useMutation(api.devices.connect);
  const unlinkAccount = useMutation(api.devices.disconnect);
  const me = useQuery(api.users.me) as { permissions?: PermissionMode } | null | undefined;
  const { user } = useUser();
  const { signOut } = useClerk();
  const [muteBusy, setMuteBusy] = useState(false);

  const device = devices[0];
  const accountLinked = device?.status === "connected";
  const connected = ble.link === "connected";
  const st = ble.status;
  const live = connected && !!st && !st.muted;
  const scanning = ble.link === "scanning";
  const linking = ble.link === "connecting" || ble.link === "reconnecting";

  const headline = connected
    ? !st
      ? "Connected. Waiting for status…"
      : st.muted
        ? "Muted. Not recording."
        : "Listening for speech."
    : linking
      ? "Reconnecting…"
      : accountLinked || stream
        ? "Not connected."
        : "No pendant yet.";

  const sub = connected
    ? `${pendantName(ble.deviceName)}${st ? ` · ${st.sd ? `${storage(st.sdFree)} free` : "no storage card"}` : ""}`
    : stream
      ? `Last conversation ${ago(stream.lastEndedAt)}`
      : "Turn the pendant on and keep it near your phone.";

  async function toggleMute() {
    if (!st) return;
    setMuteBusy(true);
    try {
      await setMuted(!st.muted);
    } catch (e) {
      Alert.alert(st.muted ? "Couldn't unmute" : "Couldn't mute", errorMessage(e));
    } finally {
      setMuteBusy(false);
    }
  }

  function accountMenu() {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: user?.fullName ?? undefined,
        message: user?.primaryEmailAddress?.emailAddress,
        options: ["Sign out", "Cancel"],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (i) => i === 0 && void forgetPushToken().finally(() => signOut()),
    );
  }

  return (
    <>
      <Stack.Screen options={{ ...largeTitle, title: "Pendant" }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="person.crop.circle" accessibilityLabel="Account" onPress={accountMenu} />
      </Stack.Toolbar>
      <Page>
        <Lede>The pendant sends audio through this phone. Each finished conversation is transcribed, then wali decides whether it&apos;s worth a word.</Lede>

        <View style={s.hero}>
          <Image source={require("../../../../assets/images/how-stream.jpg")} style={StyleSheet.absoluteFill} contentFit="cover" />
          <View style={[StyleSheet.absoluteFill, s.heroShade]} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <EmberDot live={live} />
            <Text style={s.heroMeta}>{connected ? "Connected" : linking ? "Connecting" : "Offline"}</Text>
          </View>
          <View style={{ flex: 1 }} />
          <Text style={[display(32), { color: "#FFFFFF" }]}>{headline}</Text>
          <Text style={[s.heroMeta, { marginTop: 6 }]} numberOfLines={2}>
            {sub}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
            {connected ? (
              <>
                {st ? <Pill title={st.muted ? "Unmute" : "Mute"} icon={st.muted ? "mic.fill" : "mic.slash"} kind="cream" busy={muteBusy} onPress={toggleMute} /> : null}
                <Pill title="Disconnect" kind="onPhoto" onPress={() => void disconnect()} />
              </>
            ) : (
              <Pill title={scanning ? "Looking…" : "Find my pendant"} icon="dot.radiowaves.left.and.right" kind="cream" busy={scanning} onPress={() => void scan()} />
            )}
          </View>
        </View>

        {!connected && ble.discovered.length > 0 ? (
          <Card padded={false} style={{ marginTop: 12 }}>
            {ble.discovered.map((d, i) => (
              <Row
                key={d.id}
                first={i === 0}
                icon="circle.circle"
                title={pendantName(d.name)}
                subtitle={d.rssi > -60 ? "Very close" : d.rssi > -80 ? "Nearby" : "Weak signal"}
                chevron={false}
                trailing={<Pill title="Connect" size="sm" onPress={() => void connect(d.id, d.name)} />}
              />
            ))}
          </Card>
        ) : null}
        {ble.error ? <Text style={[type.meta, { marginTop: 10 }]}>{ble.error}</Text> : null}
        {ble.adapter === "off" ? <Text style={[type.meta, { marginTop: 10 }]}>Bluetooth is off. Turn it on in Control Center.</Text> : null}
        {ble.adapter === "unauthorized" ? <Text style={[type.meta, { marginTop: 10 }]}>wali isn&apos;t allowed to use Bluetooth. Turn it on in Settings › wali.</Text> : null}
        {ble.adapter === "unsupported" ? <Text style={[type.meta, { marginTop: 10 }]}>This device has no Bluetooth (the Simulator doesn&apos;t). Diagnostics can simulate a pendant.</Text> : null}

        <Card padded={false} style={{ marginTop: 12 }}>
          <Row
            first
            icon="person.wave.2"
            title="Link to my account"
            subtitle={accountLinked ? "wali reads what your pendant hears." : "Off. Conversations are saved but wali won't read them."}
            chevron={false}
            trailing={
              <Switch
                value={accountLinked}
                trackColor={{ true: color.ink }}
                onValueChange={(on) =>
                  void (on ? linkAccount({ name: pendantName(ble.deviceName) }) : device ? unlinkAccount({ id: device._id as never }) : Promise.resolve()).catch((e) =>
                    Alert.alert("Couldn't change that", errorMessage(e)),
                  )
                }
              />
            }
          />
          <Row icon="slider.horizontal.3" title="Pendant details" subtitle="Status, storage, troubleshooting" onPress={() => router.push("/(app)/settings/device")} />
        </Card>

        <SectionHead title="wali" />
        <Card padded={false}>
          <Row first icon="bubble.left.and.exclamationmark.bubble.right" title="When wali speaks up" subtitle="Nudges, quiet hours, limits" onPress={() => router.push("/(app)/settings/proactive")} />
          <Row icon="hand.raised" title="What wali can do" subtitle={PERMISSION_LABEL[me?.permissions ?? "balanced"]} onPress={() => router.push("/(app)/settings/permissions")} />
          <Row icon="bell.badge" title="Notifications" subtitle="Nudges, approvals, updates" onPress={() => router.push("/(app)/settings/notifications")} />
          <Row icon="square.grid.2x2" title="Connections" subtitle="Gmail, Calendar, Slack and more" onPress={() => router.push("/(app)/settings/connections")} />
          <Row icon="waveform.path.ecg" title="Activity" subtitle="When wali spoke up, and when it didn't" onPress={() => router.push("/(app)/settings/activity")} />
          <Row icon="text.bubble" title="Try it without the pendant" subtitle="Run a conversation through wali" onPress={() => router.push("/(app)/settings/try")} />
        </Card>

        <SectionHead title="This phone" />
        <Card padded={false}>
          <Row first icon="stethoscope" title="Diagnostics" subtitle="Upload queue, test clip, simulated pendant" onPress={() => router.push("/(app)/settings/diagnostics")} />
          <Row icon="rectangle.portrait.and.arrow.right" title="Sign out" subtitle={user?.primaryEmailAddress?.emailAddress} chevron={false} onPress={accountMenu} />
        </Card>
      </Page>
    </>
  );
}

const s = StyleSheet.create({
  hero: { height: 330, borderRadius: 28, borderCurve: "continuous", overflow: "hidden", padding: 22, backgroundColor: color.night },
  heroShade: { experimental_backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.05) 35%, rgba(0,0,0,0.65) 100%)" },
  heroMeta: { fontFamily: font.medium, fontSize: 13.5, color: "rgba(255,255,255,0.8)" },
});

/** BLE errors arrive as plain objects ({ message, code }), not Errors. */
function errorMessage(e: unknown) {
  if (e instanceof Error) return friendlyError(e, "Try again.");
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; reason?: unknown; code?: unknown };
    const m = o.message ?? o.reason;
    if (typeof m === "string" && m) return m;
    try {
      return JSON.stringify(e);
    } catch {}
  }
  return String(e);
}
