import { router } from "expo-router";
import { useState } from "react";
import { AuthStep, Field, FormError } from "../../auth/AuthForm";
import { clerkMessage, useEmailAuth } from "../../auth/flow";
import { Pill } from "../../ui";

export default function EmailStep() {
  const { start } = useEmailAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());

  async function next() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const address = email.trim().toLowerCase();
    try {
      const mode = await start(address);
      if (mode === "signup") router.push({ pathname: "/(auth)/create", params: { email: address } });
      else router.push({ pathname: "/(auth)/code", params: { email: address, mode } });
    } catch (e) {
      setError(clerkMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthStep
      title="What's your"
      em="email?"
      lede="We'll send a code to sign you in. New to wali? You'll set up your account next."
      footer={<Pill title="Continue" size="lg" busy={busy} disabled={!valid} onPress={next} />}
    >
      <Field
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        returnKeyType="next"
        onSubmitEditing={next}
      />
      <FormError>{error}</FormError>
    </AuthStep>
  );
}
