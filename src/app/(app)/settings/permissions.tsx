import { Button, Form, Host, HStack, Image, Section, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { background, font as swiftFont, foregroundStyle, multilineTextAlignment, scrollContentBackground, tint } from "@expo/ui/swift-ui/modifiers";
import { useMutation, useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { api } from "../../../lib/convex-api";
import { PERMISSION_MODES, PERMISSIONS_NOTE, type PermissionMode } from "../../../lib/permissions";
import { color, font } from "../../../theme";
import { Spinner } from "../../../ui";

/** How much wali may do without asking. Native Form; same three choices as the web Connections page. */
export default function PermissionsSettings() {
  const me = useQuery(api.users.me) as { permissions?: PermissionMode } | null | undefined;
  const update = useMutation(api.users.updatePermissions);
  const [mode, setMode] = useState<PermissionMode | null>(null);

  useEffect(() => {
    if (me && !mode) setMode(me.permissions ?? "balanced");
  }, [me, mode]);

  function choose(next: PermissionMode) {
    if (next === mode) return;
    setMode(next);
    void Haptics.selectionAsync();
    void update({ mode: next });
  }

  const title = [swiftFont({ family: font.medium, size: 16 }), foregroundStyle(color.ink)];
  const body = [swiftFont({ family: font.body, size: 14 }), foregroundStyle(color.ink2), multilineTextAlignment("leading")];
  const note = [swiftFont({ family: font.body, size: 13 }), foregroundStyle(color.ink3), multilineTextAlignment("leading")];

  return (
    <>
      <Stack.Screen options={{ title: "What wali can do", headerLargeTitle: false }} />
      {!mode ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Spinner />
        </View>
      ) : (
        <Host style={{ flex: 1 }}>
          <Form modifiers={[scrollContentBackground("hidden"), background(color.paper), tint(color.ink)]}>
            <Section
              footer={
                <Text modifiers={note}>{PERMISSIONS_NOTE}</Text>
              }
            >
              {PERMISSION_MODES.map((m) => (
                <Button key={m.id} onPress={() => choose(m.id)}>
                  <HStack spacing={12} alignment="top">
                    <VStack alignment="leading" spacing={4}>
                      <Text modifiers={title}>{m.title}</Text>
                      <Text modifiers={body}>{m.summary}</Text>
                      <Text modifiers={note}>{m.examples}</Text>
                    </VStack>
                    <Spacer />
                    <Image systemName={mode === m.id ? "checkmark.circle.fill" : "circle"} size={22} color={mode === m.id ? color.ink : color.ink3} />
                  </HStack>
                </Button>
              ))}
            </Section>
          </Form>
        </Host>
      )}
    </>
  );
}
