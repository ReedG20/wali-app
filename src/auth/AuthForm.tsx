import { forwardRef, type ComponentRef, type ReactNode } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, display, font, softShadow, type } from "../theme";

/** A form step: big Fraunces question, quiet lede, fields, and the primary action riding the keyboard. */
export function AuthStep({
  title,
  em,
  lede,
  children,
  footer,
}: {
  title: string;
  em?: string;
  lede?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: color.paper }}>
      <KeyboardAwareScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 120 }}
      >
        <Text style={display(42)}>
          {title}
          {em ? <Text style={[display(42, true), { color: color.ink2 }]}> {em}</Text> : null}
        </Text>
        {lede ? <Text style={[type.secondary, { marginTop: 12, marginBottom: 28 }]}>{lede}</Text> : <View style={{ height: 28 }} />}
        <View style={{ gap: 12 }}>{children}</View>
      </KeyboardAwareScrollView>
      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom - 12 }}>
        <View style={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 12, paddingTop: 8, gap: 12 }}>{footer}</View>
      </KeyboardStickyView>
    </View>
  );
}

/** Inputs are pills (design brief). A native UITextField underneath, so autofill and paste work. */
export const Field = forwardRef<ComponentRef<typeof TextInput>, TextInputProps & { label?: string }>(function Field({ label, style, ...props }, ref) {
  return (
    <View>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={color.ink3}
        selectionColor={color.ember}
        style={[s.input, style]}
        {...props}
      />
    </View>
  );
});

export function FormError({ children }: { children?: string | null }) {
  if (!children) return null;
  return <Text style={[type.secondary, { fontSize: 14, color: "#8A3B12" }]}>{children}</Text>;
}

const s = StyleSheet.create({
  label: { fontFamily: font.medium, fontSize: 13.5, color: color.ink2, marginBottom: 6, marginLeft: 6 },
  input: {
    height: 56,
    borderRadius: 999,
    backgroundColor: color.card,
    paddingHorizontal: 22,
    fontFamily: font.body,
    fontSize: 17,
    color: color.ink,
    ...softShadow,
  },
});
