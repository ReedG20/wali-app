import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { color, font, softShadow } from "../theme";
import { Icon } from "../ui";

const glass = isLiquidGlassAvailable();

/**
 * The message field: a native multiline text view in a Liquid Glass capsule (a white soft card
 * before iOS 26), with the send button tucked inside on the right.
 */
export function Composer({
  onSend,
  disabled,
  placeholder = "Talk to wali…",
  autoFocus,
}: {
  /** Resolve false if the message didn't go: the text is put back so it isn't lost. */
  onSend: (text: string) => Promise<boolean | void> | boolean | void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const canSend = value.trim().length > 0 && !disabled;

  async function submit() {
    if (!canSend) return;
    const text = value.trim();
    setValue("");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const sent = await onSend(text);
    // Only if the field is still empty: don't clobber something typed in the meantime.
    if (sent === false) setValue((current) => current || text);
  }

  const body = (
    <>
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={color.ink3}
        multiline
        autoFocus={autoFocus}
        style={s.input}
        selectionColor={color.ember}
        accessibilityLabel="Message"
      />
      <Pressable
        onPress={submit}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send"
        style={({ pressed }) => [s.send, !canSend && s.sendOff, pressed && { opacity: 0.8 }]}
      >
        <Icon name="arrow.up" size={16} tint={canSend ? "#FFFFFF" : color.ink3} />
      </Pressable>
    </>
  );

  return glass ? (
    <GlassView glassEffectStyle="regular" tintColor="rgba(255,255,255,0.55)" isInteractive style={s.shell}>
      {body}
    </GlassView>
  ) : (
    <View style={[s.shell, s.solid]}>{body}</View>
  );
}

const s = StyleSheet.create({
  shell: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderRadius: 26,
    borderCurve: "continuous",
    paddingLeft: 18,
    padding: 6,
    minHeight: 52,
  },
  solid: { backgroundColor: color.card, ...softShadow },
  input: {
    flex: 1,
    maxHeight: 160,
    paddingTop: 10,
    paddingBottom: 10,
    fontFamily: font.body,
    fontSize: 16,
    lineHeight: 21,
    color: color.ink,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: color.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  sendOff: { backgroundColor: "rgba(22,21,19,0.08)" },
});
