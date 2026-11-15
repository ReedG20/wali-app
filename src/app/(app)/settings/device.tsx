import { Button, Form, Gauge, Host, LabeledContent, Section, Text } from "@expo/ui/swift-ui";
import { background, foregroundStyle, monospacedDigit, scrollContentBackground, tint } from "@expo/ui/swift-ui/modifiers";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { bleStore, disconnect, forget, scan, sendCommand } from "../../../lib/ble";
import { pendantName } from "../../../lib/pendantName";
import { levelToDbfs } from "../../../lib/protocol";
import { recorderStore } from "../../../lib/recorder";
import { useStore } from "../../../lib/store";
import { duration, storage } from "../../../lib/time";
import { uploaderStore } from "../../../lib/uploader";
import { color } from "../../../theme";

/** Re-render every second so ages ("Xs ago") stay truthful even when nothing else changes. */
function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(h);
  }, [ms]);
  return now;
}

const ago = (now: number, t: number | null) => (t ? `${duration(Math.max(0, now - t))} ago` : "Never");
const db = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "–" : `${v.toFixed(1)} dB`);
const yn = (b: boolean | null) => (b === null ? "?" : b ? "Yes" : "No");

const LINK: Record<string, string> = {
  idle: "Not connected",
  scanning: "Looking for your pendant",
  connecting: "Connecting",
  reconnecting: "Reconnecting",
  connected: "Connected",
};
const ADAPTER: Record<string, string> = { on: "On", off: "Off", unauthorized: "Not allowed", unsupported: "Not available", unknown: "Checking" };
const sentence = (v: string) => (v ? v[0].toUpperCase() + v.slice(1) : v);

async function command(cmd: string) {
  try {
    await sendCommand(cmd);
  } catch (e) {
    Alert.alert("The pendant didn't respond", "Make sure it's on and nearby, then try again.");
    console.warn(`[ble] command "${cmd}" failed:`, e);
  }
}

/** The pendant's live numbers and link health, as a native grouped list. */
export default function DeviceDetails() {
  const ble = useStore(bleStore);
  const rec = useStore(recorderStore);
  const up = useStore(uploaderStore);
  const now = useNow();
  const st = ble.status;
  const connected = ble.link === "connected";
  const statusAge = ble.statusAt ? Math.round((now - ble.statusAt) / 1000) : null;

  const V = ({ children, warn }: { children: string | number; warn?: boolean }) => (
    <Text modifiers={[monospacedDigit(), foregroundStyle(warn ? "#B4541A" : color.ink2)]}>{String(children)}</Text>
  );
  const Item = ({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) => (
    <LabeledContent label={label}>
      <V warn={warn}>{value}</V>
    </LabeledContent>
  );
  const level = st ? levelToDbfs(st.lvl) : -90;

  return (
    <>
      <Stack.Screen options={{ title: "Pendant details", headerLargeTitle: false }} />
      <Host style={{ flex: 1 }}>
        <Form modifiers={[scrollContentBackground("hidden"), background(color.paper), tint(color.ink)]}>
          <Section title="Pendant" footer={connected && statusAge !== null && statusAge > 6 ? <Text>Last heard from the pendant {statusAge} seconds ago, so some of this may be out of date.</Text> : undefined}>
            <Item label="Status" value={LINK[ble.link] ?? sentence(ble.link)} />
            <Item label="Bluetooth" value={ADAPTER[ble.adapter] ?? sentence(ble.adapter)} warn={ble.adapter === "off" || ble.adapter === "unauthorized"} />
            <Item label="Name" value={ble.deviceName || ble.deviceId ? pendantName(ble.deviceName) : "None"} />
            {st ? (
              <>
                <Item label="Microphone" value={st.muted ? "Muted" : "On"} warn={st.muted} />
                <Item label="Records" value={st.mode === "all" ? "Everything" : "When someone is speaking"} />
                <Item label="Storage" value={st.sd ? `${storage(st.sdFree)} free` : "No card (short buffer only)"} />
                <Item label="Not yet sent to this phone" value={st.buf ? `${duration(st.buf * 20)} of audio` : "Nothing"} />
                <Item label="Software" value={String(st.fw)} />
              </>
            ) : (
              <Text modifiers={[foregroundStyle(color.ink3)]}>{connected ? "Waiting for the pendant to report in." : "Connect your pendant to see its status."}</Text>
            )}
            {ble.error ? <Text modifiers={[foregroundStyle("#B4541A")]}>{ble.error}</Text> : null}
          </Section>

          {connected ? (
            <Section title="Actions" footer={<Text>Recording everything uses more battery and storage than recording only speech.</Text>}>
              <Button
                label={st?.mode === "all" ? "Record only when someone speaks" : "Record everything"}
                systemImage={st?.mode === "all" ? "waveform.badge.mic" : "waveform"}
                onPress={() => command(st?.mode === "all" ? "mode gated" : "mode all")}
              />
              <Button label="Send waiting audio now" systemImage="arrow.triangle.2.circlepath" onPress={() => command("sync")} />
              <Button label="Refresh status" systemImage="arrow.clockwise" onPress={() => command("status")} />
            </Section>
          ) : null}

          <Section title="Technical details" footer={<Text>For troubleshooting. Nothing here needs your attention unless something looks wrong.</Text>}>
            {st ? (
              <>
                <Gauge value={Math.max(0, Math.min(1, (level + 90) / 90))} currentValueLabel={<Text>{db(level)}</Text>}>
                  <Text>Sound level (background {db(st.nf)}, starts recording at {db(levelToDbfs(st.wake))})</Text>
                </Gauge>
                <Item label="Microphone gain" value={st.gain} />
                <Item label="Audio lost on the pendant" value={st.lost ? duration(st.lost * 20) : "None"} warn={!!st.lost} />
                <Item label="Running for" value={duration(st.seq * 20)} />
                <Item label="Protocol" value={`v${st.v}`} />
              </>
            ) : null}
            <Item label="Bluetooth packet size" value={ble.maxPayload == null ? "–" : ble.maxPayload + 3} warn={ble.maxPayload != null && ble.maxPayload < 172} />
            <Item label="Reconnects" value={ble.reconnects} />
            <Item label="Audio received per second" value={`${rec.framesPerSec.toFixed(1)} frames`} />
            <Item label="Received this session" value={duration(rec.framesTotal * 20)} />
            <Item label="Caught up from storage" value={duration(rec.backfillFrames * 20)} />
            <Item label="Gaps" value={rec.lossEvents ? `${rec.lossEvents} (${duration(rec.lostFrames * 20)})` : "None"} warn={!!rec.lossEvents} />
            <Item label="Pauses between speech" value={rec.pauses} />
            <Item label="Repeated / unreadable" value={`${rec.duplicateFrames} / ${rec.badFrames}`} />
            <Item label="Recording now" value={rec.openSegmentId ? duration(rec.openSegmentFrames * 20) : "No"} />
            {rec.lastError ? <Text modifiers={[foregroundStyle("#B4541A")]}>{rec.lastError}</Text> : null}
          </Section>

          <Section title="In the background">
            <Item label="App" value={sentence(rec.appState) + (rec.backgroundSince ? ` (${ago(now, rec.backgroundSince)})` : "")} />
            <Item label="Received in the background" value={duration(rec.bgFrames * 20)} />
            <Item label="Conversations finished in the background" value={rec.bgSegmentsClosed} />
            <Item label="Last audio" value={ago(now, rec.lastFrameAt)} />
            <Item
              label="Listening for audio / status"
              value={`${yn(ble.audioNotifying)} / ${yn(ble.statusNotifying)}`}
              warn={ble.audioNotifying === false || ble.statusNotifying === false}
            />
            <Item label="Last status update" value={ago(now, ble.lastStatusNotifyAt)} warn={connected && ble.statusViaNotify === 0 && ble.statusViaRead > 3} />
            <Item label="Uploads" value={`${up.online ? "Online" : "Offline"}${up.busy ? ", uploading" : ""}`} />
            <Item label="Last upload" value={ago(now, up.lastSuccessAt)} />
            <Item label="Save errors / recovered" value={`${rec.writeErrors} / ${rec.recoveredSegments}`} warn={!!rec.writeErrors} />
            {up.lastError ? <Text modifiers={[foregroundStyle("#B4541A")]}>Upload: {up.lastError}</Text> : null}
          </Section>

          {/* Kept apart from the read-only rows above so they can't be hit by accident. */}
          <Section footer={ble.deviceId ? <Text>Forgetting means this phone stops reconnecting to the pendant until you find it again.</Text> : undefined}>
            <Button label={ble.link === "scanning" ? "Looking…" : "Look for pendants"} systemImage="dot.radiowaves.left.and.right" onPress={() => void scan()} />
            {ble.link !== "idle" ? <Button label="Disconnect" systemImage="xmark.circle" onPress={() => void disconnect()} /> : null}
            {ble.deviceId ? (
              <Button
                label="Forget this pendant"
                systemImage="trash"
                role="destructive"
                onPress={() =>
                  Alert.alert("Forget this pendant?", "This phone will stop reconnecting to it until you find it again.", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Forget", style: "destructive", onPress: () => void forget() },
                  ])
                }
              />
            ) : null}
          </Section>
        </Form>
      </Host>
    </>
  );
}
