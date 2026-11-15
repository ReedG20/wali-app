import { DatePicker, Form, Host, Section, Stepper, Text, Toggle } from "@expo/ui/swift-ui";
import { datePickerStyle, font as swiftFont, foregroundStyle, scrollContentBackground, background, tint } from "@expo/ui/swift-ui/modifiers";
import { useMutation, useQuery } from "convex/react";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { errorText } from "../../../chat/Cards";
import { api } from "../../../lib/convex-api";
import { LIMITS, PROACTIVE_COPY as C, type Proactive } from "../../../lib/settingsCopy";
import { color, font } from "../../../theme";
import { Spinner } from "../../../ui";

const atHour = (h: number) => {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d;
};
/** The backend stores whole hours; the picker snaps to the nearest one. */
const toHour = (d: Date) => (d.getMinutes() >= 30 ? (d.getHours() + 1) % 24 : d.getHours());

/**
 * Fully native settings: a SwiftUI Form with toggles, the system time pickers for quiet hours,
 * and steppers for the limits. Same rules and copy as the web app's Pendant page.
 */
export default function ProactiveSettings() {
  const me = useQuery(api.users.me) as { proactive: Proactive } | null | undefined;
  const update = useMutation(api.users.updateProactive);
  const [p, setP] = useState<Proactive | null>(null);

  useEffect(() => {
    if (me && !p) setP(me.proactive);
  }, [me, p]);

  function save(patch: Partial<Proactive>) {
    if (!p) return;
    const next = { ...p, ...patch };
    setP(next);
    update(next).catch((e) => Alert.alert("Couldn't save", errorText(e, "Try again.")));
  }

  const body = [swiftFont({ family: font.body, size: 16 })];
  const note = [swiftFont({ family: font.body, size: 13 }), foregroundStyle(color.ink2)];

  return (
    <>
      <Stack.Screen options={{ title: C.title, headerLargeTitle: false }} />
      {!p ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Spinner />
        </View>
      ) : (
        <Host style={{ flex: 1 }}>
          <Form modifiers={[scrollContentBackground("hidden"), background(color.paper), tint(color.ink)]}>
            <Section footer={<Text modifiers={note}>{C.intro}</Text>}>
              <Toggle isOn={p.enabled} onIsOnChange={(enabled) => save({ enabled })} modifiers={body}>
                <Text>{C.enabled.title}</Text>
                <Text>{C.enabled.hint}</Text>
              </Toggle>
            </Section>

            <Section footer={<Text modifiers={note}>{p.quietEnabled ? C.quiet.on : C.quiet.off}</Text>}>
              <Toggle label={C.quiet.title} isOn={p.quietEnabled} onIsOnChange={(quietEnabled) => save({ quietEnabled })} modifiers={body} />
              {p.quietEnabled ? (
                <>
                  <DatePicker
                    title="From"
                    selection={atHour(p.quietStartHour)}
                    displayedComponents={["hourAndMinute"]}
                    onDateChange={(d) => save({ quietStartHour: toHour(d) })}
                    modifiers={[...body, datePickerStyle("compact")]}
                  />
                  <DatePicker
                    title="Until"
                    selection={atHour(p.quietEndHour)}
                    displayedComponents={["hourAndMinute"]}
                    onDateChange={(d) => save({ quietEndHour: toHour(d) })}
                    modifiers={[...body, datePickerStyle("compact")]}
                  />
                </>
              ) : null}
            </Section>

            <Section title={C.limits.title} footer={<Text modifiers={note}>{C.limits.footer}</Text>}>
              <Stepper label={C.perHour(p.maxPerHour)} value={p.maxPerHour} min={0} max={LIMITS.maxPerHour} onValueChange={(v) => save({ maxPerHour: v })} modifiers={body} />
              <Stepper label={C.perDay(p.maxPerDay)} value={p.maxPerDay} min={0} max={LIMITS.maxPerDay} onValueChange={(v) => save({ maxPerDay: v })} modifiers={body} />
            </Section>
          </Form>
        </Host>
      )}
    </>
  );
}
