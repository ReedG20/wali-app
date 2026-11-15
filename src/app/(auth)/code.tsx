import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, Text } from "react-native";
import { AuthStep, Field, FormError } from "../../auth/AuthForm";
import { clerkMessage, useEmailAuth } from "../../auth/flow";
import { color, font } from "../../theme";
import { Pill } from "../../ui";

/** The emailed six-digit code. iOS offers it above the keyboard (one-time-code autofill). */
export default function CodeStep() {
  const { email, mode } = useLocalSearchParams<{ email: string; mode: "signin" | "signup" }>();
  const { verify, resend } = useEmailAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function submit(value = code) {
    if (value.length < 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verify(mode, value);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Signed in: the root guard swaps to the app.
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(clerkMessage(e));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthStep
      title="Check your"
      em="email."
      lede={`We sent a code to ${email}.`}
      footer={<Pill title={mode === "signup" ? "Verify and start" : "Sign in"} size="lg" busy={busy} disabled={code.length < 6} onPress={() => submit()} />}
    >
      <Field
        value={code}
        onChangeText={(t) => {
          const digits = t.replace(/\D/g, "").slice(0, 6);
          setCode(digits);
          if (digits.length === 6) void submit(digits);
        }}
        placeholder="000000"
        autoFocus
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        style={{ fontFamily: font.medium, fontSize: 24, letterSpacing: 8, textAlign: "center" }}
      />
      <FormError>{error}</FormError>
      <Pressable
        hitSlop={10}
        onPress={async () => {
          try {
            await resend(mode);
            setResent(true);
          } catch (e) {
            setError(clerkMessage(e));
          }
        }}
        style={{ alignSelf: "center", marginTop: 6 }}
      >
        <Text style={{ fontFamily: font.body, fontSize: 14.5, color: color.ink2, textDecorationLine: "underline" }}>
          {resent ? "Sent again" : "Send a new code"}
        </Text>
      </Pressable>
    </AuthStep>
  );
}
