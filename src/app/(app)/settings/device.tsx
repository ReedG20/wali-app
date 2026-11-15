import { Button, Form, Gauge, Host, LabeledContent, Section, Text } from "@expo/ui/swift-ui";
import { background, foregroundStyle, monospacedDigit, scrollContentBackground, tint } from "@expo/ui/swift-ui/modifiers";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { bleStore, disconnect, forget, scan, sendCommand } from "../../../lib/ble";
import { levelToDbfs } from "../../../lib/protocol";
import { recorderStore } from "../../../lib/recorder";
import { useStore } from "../../../lib/store";
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

const ago = (now: number, t: number | null) => (t ? `${Math.max(0, Math.round((now - t) / 1000))}s ago` : "never");
const db = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "–" : `${v.toFixed(1)} dB`);
const yn = (b: boolean | null) => (b === null ? "?" : b ? "Yes" : "No");

async function command(cmd: string) {
  try {
    await sendCommand(cmd);
  } catch (e) {
    Alert.alert("Command failed", `${cmd}: ${e instanceof Error ? e.message : String(e)}`);
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
          <Section title="Connection">
            <Item label="State" value={ble.link} />
            <Item label="Bluetooth" value={ble.adapter} />
            <Item label="Device" value={ble.deviceName ?? ble.deviceId?.slice(0, 8) ?? "None"} />
            <Item label="MTU" value={ble.maxPayload == null ? "–" : ble.maxPayload + 3} warn={ble.maxPayload != null && ble.maxPayload < 172} />
            <Item label="Reconnects" value={ble.reconnects} />
            {ble.error ? <Text modifiers={[foregroundStyle("#B4541A")]}>{ble.error}</Text> : null}
            <Button label={ble.link === "scanning" ? "Scanning…" : "Scan for pendants"} systemImage="dot.radiowaves.left.and.right" onPress={() => void scan()} />
            {ble.link !== "idle" ? <Button label="Disconnect" onPress={() => void disconnect()} /> : null}
            {ble.deviceId ? <Button label="Forget this pendant" role="destructive" onPress={() => void forget()} /> : null}
          </Section>

          <Section title={`Pendant status${statusAge === null ? "" : ` · ${statusAge}s ago`}`} footer={connected && statusAge !== null && statusAge > 6 ? <Text>Status is {statusAge}s old, so these values may be out of date.</Text> : undefined}>
            {st ? (
              <>
                <Gauge value={Math.max(0, Math.min(1, (level + 90) / 90))} currentValueLabel={<Text>{db(level)}</Text>}>
                  <Text>Level (noise floor {db(st.nf)}, wake {db(levelToDbfs(st.wake))})</Text>
                </Gauge>
                <Item label="Muted" value={st.muted ? "Yes" : "No"} warn={st.muted} />
                <Item label="Mode" value={st.mode} />
                <Item label="Backlog" value={st.buf} />
                <Item label="Lost on board" value={st.lost} warn={!!st.lost} />
                <Item label="Storage" value={st.sd ? `SD, ${st.sdFree} MB free` : "PSRAM ring"} />
                <Item label="Gain" value={st.gain} />
                <Item label="Firmware" value={`${st.fw} · protocol v${st.v}`} />
                <Item label="Boot / uptime" value={`${st.boot} / ${Math.round((st.seq * 20) / 1000)}s`} />
                <Item label="Seq" value={st.seq} />
              </>
            ) : (
              <Text modifiers={[foregroundStyle(color.ink3)]}>No status yet.</Text>
            )}
            {connected ? (
              <>
                <Button label={st?.mode === "all" ? "Switch to gated mode" : "Record everything (mode all)"} onPress={() => command(st?.mode === "all" ? "mode gated" : "mode all")} />
                <Button label="Sync backlog" onPress={() => command("sync")} />
                <Button label="Request status" onPress={() => command("status")} />
              </>
            ) : null}
          </Section>

          <Section title="Received this session">
            <Item label="Frames per second" value={rec.framesPerSec.toFixed(1)} />
            <Item label="Frames" value={rec.framesTotal} />
            <Item label="Backfill frames" value={rec.backfillFrames} />
            <Item label="Loss (events / frames)" value={`${rec.lossEvents} / ${rec.lostFrames}`} warn={!!rec.lossEvents} />
            <Item label="Gated pauses" value={rec.pauses} />
            <Item label="Duplicate / bad" value={`${rec.duplicateFrames} / ${rec.badFrames}`} />
            <Item label="Last seq / boot tag" value={rec.lastSeq === null ? "–" : `${rec.lastSeq} / ${rec.lastBootTag}`} />
            <Item label="Open segment" value={rec.openSegmentId ? `${rec.openSegmentId.slice(0, 8)} (${(rec.openSegmentFrames / 50).toFixed(1)}s)` : "None"} />
            {rec.lastError ? <Text modifiers={[foregroundStyle("#B4541A")]}>{rec.lastError}</Text> : null}
          </Section>

          <Section title="Background and link health">
            <Item label="App state" value={rec.appState + (rec.backgroundSince ? ` (${ago(now, rec.backgroundSince)})` : "")} />
            <Item label="Frames in background" value={`${rec.bgFrames} / ${rec.bgBackfillFrames} backfill`} />
            <Item label="Segments closed in background" value={rec.bgSegmentsClosed} />
            <Item label="Last frame" value={ago(now, rec.lastFrameAt)} />
            <Item
              label="Subscribed (audio / status)"
              value={`${yn(ble.audioNotifying)} / ${yn(ble.statusNotifying)}`}
              warn={ble.audioNotifying === false || ble.statusNotifying === false}
            />
            <Item label="Status via notify / read" value={`${ble.statusViaNotify} / ${ble.statusViaRead}`} warn={connected && ble.statusViaNotify === 0 && ble.statusViaRead > 3} />
            <Item label="Last status notification" value={ago(now, ble.lastStatusNotifyAt)} />
            <Item label="Uploader" value={`${up.online ? "Online" : "Offline"}${up.busy ? ", uploading" : ""}`} />
            <Item label="Last upload" value={ago(now, up.lastSuccessAt)} />
            <Item label="Write errors / recovered" value={`${rec.writeErrors} / ${rec.recoveredSegments}`} />
            {up.lastError ? <Text modifiers={[foregroundStyle("#B4541A")]}>Upload: {up.lastError}</Text> : null}
          </Section>
        </Form>
      </Host>
    </>
  );
}
