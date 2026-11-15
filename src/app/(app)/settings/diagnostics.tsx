import { Button, Form, Host, LabeledContent, Section, Text } from "@expo/ui/swift-ui";
import { background, foregroundStyle, monospacedDigit, scrollContentBackground, tint } from "@expo/ui/swift-ui/modifiers";
import Constants from "expo-constants";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { Alert } from "react-native";
import { CONVEX_URL } from "../../../lib/convex";
import { segmentsDir } from "../../../lib/files";
import { simulatePendant, uploadTestClip } from "../../../lib/pipeline";
import { closeOpen, recorderStore } from "../../../lib/recorder";
import { useStore } from "../../../lib/store";
import { bleError } from "../../../lib/ble";
import { retryAllNow, uploaderStore } from "../../../lib/uploader";
import { useLocalSegments } from "../../../lib/useLocalSegments";
import { color } from "../../../theme";

function run(what: string, f: () => Promise<unknown> | unknown) {
  Promise.resolve()
    .then(f)
    .catch((e) => Alert.alert(`${what} failed`, bleError(e).message));
}

/**
 * The phone side of the pipeline: local queue, uploader, and two pipeline tests.
 * Dev builds: wali://settings/diagnostics?run=simulate|upload runs a test without tapping
 * (from the simulator: xcrun simctl openurl booted "wali://settings/diagnostics?run=simulate").
 */
export default function Diagnostics() {
  const up = useStore(uploaderStore);
  const rec = useStore(recorderStore);
  const { counts } = useLocalSegments(1);
  const { run: runParam } = useLocalSearchParams<{ run?: string }>();
  useEffect(() => {
    if (!__DEV__ || !runParam) return;
    router.setParams({ run: undefined });
    if (runParam === "simulate") run("Simulate", simulatePendant);
    if (runParam === "upload") run("Upload test clip", uploadTestClip);
  }, [runParam]);

  let diskMb = "–";
  try {
    diskMb = ((segmentsDir.size ?? 0) / 1e6).toFixed(1);
  } catch {
    // directory may not exist yet
  }

  const Item = ({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) => (
    <LabeledContent label={label}>
      <Text modifiers={[monospacedDigit(), foregroundStyle(warn ? "#B4541A" : color.ink2)]}>{String(value)}</Text>
    </LabeledContent>
  );

  return (
    <>
      <Stack.Screen options={{ title: "Diagnostics", headerLargeTitle: false }} />
      <Host style={{ flex: 1 }}>
        <Form modifiers={[scrollContentBackground("hidden"), background(color.paper), tint(color.ink)]}>
          <Section title="Backend">
            <Item label="Convex" value={CONVEX_URL.replace("https://", "") || "NOT SET"} warn={!CONVEX_URL} />
            <Item label="App version" value={Constants.expoConfig?.version ?? "?"} />
          </Section>

          <Section title="Local queue">
            <Item label="Saving" value={counts.recording} />
            <Item label="Queued" value={counts.queued} />
            <Item label="Uploading" value={counts.uploading} />
            <Item label="Uploaded" value={counts.uploaded} />
            <Item label="Broken" value={counts.broken} warn={!!counts.broken} />
            <Item label="Audio on disk" value={`${diskMb} MB`} />
            <Item label="Network" value={up.online ? "Online" : "Offline"} warn={!up.online} />
            <Item label="Uploader" value={up.busy ? `Busy ${up.current?.slice(0, 8) ?? ""}` : "Idle"} />
            <Item label="Uploaded this session" value={up.uploadedThisSession} />
            {up.lastError ? <Text modifiers={[foregroundStyle("#B4541A")]}>Upload: {up.lastError}</Text> : null}
            {rec.lastError ? <Text modifiers={[foregroundStyle("#B4541A")]}>Recorder: {rec.lastError}</Text> : null}
            {rec.openSegmentId ? <Button label="Close the open segment" onPress={() => closeOpen()} /> : null}
            <Button label="Retry uploads now" onPress={retryAllNow} />
          </Section>

          <Section
            title="Pipeline test"
            footer={
              <Text>
                Uses Scribe credits. The clip is 17.5 s of two synthetic voices. Simulate pendant encodes it into 172-byte ADPCM frames and feeds them
                through the same path as Bluetooth audio.
              </Text>
            }
          >
            <Button label="Upload test clip" systemImage="arrow.up.circle" onPress={() => run("Upload test clip", uploadTestClip)} />
            <Button
              label="Simulate pendant"
              systemImage="waveform.badge.plus"
              onPress={() =>
                run("Simulate", async () => {
                  const n = await simulatePendant();
                  Alert.alert("Simulated", `${n} frames went through the recorder.`);
                })
              }
            />
          </Section>
        </Form>
      </Host>
    </>
  );
}
