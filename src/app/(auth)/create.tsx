import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState, type ComponentRef } from "react";
import type { TextInput } from "react-native";
import { AuthStep, Field, FormError } from "../../auth/AuthForm";
import { clerkMessage, useEmailAuth } from "../../auth/flow";
import { Pill } from "../../ui";

/** New email: name and a password (the iOS strong-password suggestion fills it), then a code. */
export default function CreateAccount() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const { createAccount } = useEmailAuth();
  const [first, setFirst] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pw = useRef<ComponentRef<typeof TextInput>>(null);
  const valid = first.trim().length > 0 && password.length >= 8;

  async function next() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createAccount({ email, password, firstName: first.trim() });
      router.push({ pathname: "/(auth)/code", params: { email, mode: "signup" } });
    } catch (e) {
      setError(clerkMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthStep
      title="Meet"
      em="wali."
      lede={`Creating an account for ${email}.`}
      footer={<Pill title="Create account" size="lg" busy={busy} disabled={!valid} onPress={next} />}
    >
      <Field
        label="Your first name"
        value={first}
        onChangeText={setFirst}
        placeholder="First name"
        autoFocus
        textContentType="givenName"
        autoComplete="given-name"
        returnKeyType="next"
        onSubmitEditing={() => pw.current?.focus()}
      />
      <Field
        ref={pw}
        label="A password"
        value={password}
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        secureTextEntry
        textContentType="newPassword"
        autoComplete="new-password"
        passwordRules="minlength: 8;"
        returnKeyType="go"
        onSubmitEditing={next}
      />
      <FormError>{error}</FormError>
    </AuthStep>
  );
}
