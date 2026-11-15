import { Button, Form, Host, LabeledContent, Section, Text, Toggle } from "@expo/ui/swift-ui";
import { background, font as swiftFont, foregroundStyle, scrollContentBackground, tint } from "@expo/ui/swift-ui/modifiers";
import { useAction, useMutation, useQuery } from "convex/react";
import * as Device from "expo-device";
import { Stack, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, View } from "react-native";
import { api } from "../../../lib/convex-api";
import { pushPermission, requestPushToken, type PushPermission } from "../../../lib/notifications";
import { NOTIFY_COPY as C, type Notify } from "../../../lib/settingsCopy";
import { ago } from "../../../lib/time";
import { color, font } from "../../../theme";
import { Spinner } from "../../../ui";

type Phone = { _id: string; platform: string; deviceName: string | null; updatedAt: number };

const STATUS: Record<PushPermission, string> = {
  granted: "On",
  denied: "Off in iOS Settings",
  undetermined: "Not set up",
  unsupported: "Not available",
};

/** Which of wali's messages reach this phone. Same switches and copy as the web app's Pendant page. */
export default function NotificationSettings() {
  const me = useQuery(api.users.me) as { notify: Notify } | null | undefined;
  const phones = (useQuery(api.push.devices) ?? []) as Phone[];
  const update = useMutation(api.users.updateNotify);
  const register = useMutation(api.push.register);
  const sendTest = useAction(api.push.sendTest);
  const [n, setN] = useState<Notify | null>(null);
  const [perm, setPerm] = useState<PushPermission | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (me && !n) setN(me.notify);
  }, [me, n]);

  // Coming back from iOS Settings may have changed the answer.
  useFocusEffect(
    useCallback(() => {
      void pushPermission().then(setPerm);
    }, []),
  );

  function save(patch: Partial<Notify>) {
    if (!n) return;
    const next = { ...n, ...patch };
    setN(next);
    update(next).catch((e) => Alert.alert("Couldn't save", e instanceof Error ? e.message : String(e)));
  }

  async function turnOn() {
    if (perm === "denied") return void Linking.openSettings();
    try {
      const token = await requestPushToken(true);
      if (token) await register({ token, platform: "ios", deviceName: Device.deviceName ?? undefined });
    } catch (e) {
      Alert.alert("Couldn't turn on notifications", e instanceof Error ? e.message : String(e));
    }
    setPerm(await pushPermission());
  }

  async function test() {
    setTesting(true);
    try {
      const { sent } = await sendTest({});
      if (!sent) Alert.alert("Nothing was sent", "This phone isn't registered yet, or Apple hasn't accepted the push key. Check the EAS push credentials.");
    } catch (e) {
      Alert.alert("Couldn't send", e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  const body = [swiftFont({ family: font.body, size: 16 })];
  const note = [swiftFont({ family: font.body, size: 13 }), foregroundStyle(color.ink2)];
  const value = [swiftFont({ family: font.body, size: 15 }), foregroundStyle(color.ink3)];

  return (
    <>
      <Stack.Screen options={{ title: C.title, headerLargeTitle: false }} />
      {!n || !perm ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Spinner />
        </View>
      ) : (
        <Host style={{ flex: 1 }}>
          <Form modifiers={[scrollContentBackground("hidden"), background(color.paper), tint(color.ink)]}>
            <Section footer={<Text modifiers={note}>{C.intro}</Text>}>
              <LabeledContent label="This phone" modifiers={body}>
                <Text modifiers={value}>{STATUS[perm]}</Text>
              </LabeledContent>
              {perm === "granted" ? (
                <Button label={testing ? "Sending…" : "Send a test notification"} systemImage="paperplane" onPress={() => void test()} />
              ) : perm !== "unsupported" ? (
                <Button label={perm === "denied" ? "Open iOS Settings" : "Turn on notifications"} systemImage="bell" onPress={() => void turnOn()} />
              ) : null}
            </Section>

            <Section title={C.section} footer={<Text modifiers={note}>{C.footer}</Text>}>
              {C.rows.map((r) => (
                <Toggle key={r.key} isOn={n[r.key]} onIsOnChange={(on) => save({ [r.key]: on })} modifiers={body}>
                  <Text>{r.title}</Text>
                  <Text>{r.hint}</Text>
                </Toggle>
              ))}
            </Section>

            {phones.length ? (
              <Section title="Where you get them">
                {phones.map((p) => (
                  <LabeledContent key={p._id} label={p.deviceName ?? "iPhone"} modifiers={body}>
                    <Text modifiers={value}>{ago(p.updatedAt)}</Text>
                  </LabeledContent>
                ))}
              </Section>
            ) : null}
          </Form>
        </Host>
      )}
    </>
  );
}
