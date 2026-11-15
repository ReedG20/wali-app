// Email sign-in / sign-up on Clerk's Core 3 ("future") API, plus Google through the system browser.
// Sign-in uses an emailed code. New emails create an account (this instance requires a password),
// then verify the address with the same kind of code.
import { useSignIn, useSignUp, useSSO } from "@clerk/expo";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { useCallback } from "react";

WebBrowser.maybeCompleteAuthSession();

type ClerkishError = { code?: string; message?: string; errors?: { code?: string; message?: string; longMessage?: string }[] };

export function clerkCode(e: unknown): string | undefined {
  const err = e as ClerkishError | null;
  return err?.errors?.[0]?.code ?? err?.code;
}

export function clerkMessage(e: unknown, fallback = "Something went wrong. Try again."): string {
  const err = e as ClerkishError | null;
  return err?.errors?.[0]?.longMessage ?? err?.errors?.[0]?.message ?? err?.message ?? fallback;
}

function check(res: { error: unknown | null }) {
  if (res.error) throw res.error;
}

export function useEmailAuth() {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();

  /** Returns "signin" when a code was sent to an existing account, "signup" when the email is new. */
  const start = useCallback(
    async (email: string): Promise<"signin" | "signup"> => {
      const res = await signIn.create({ identifier: email });
      if (res.error) {
        if (clerkCode(res.error) === "form_identifier_not_found") return "signup";
        throw res.error;
      }
      check(await signIn.emailCode.sendCode());
      return "signin";
    },
    [signIn],
  );

  const createAccount = useCallback(
    async (p: { email: string; password: string; firstName: string; lastName?: string }) => {
      check(await signUp.password({ emailAddress: p.email, password: p.password, firstName: p.firstName, lastName: p.lastName || undefined }));
      check(await signUp.verifications.sendEmailCode());
    },
    [signUp],
  );

  const verify = useCallback(
    async (mode: "signin" | "signup", code: string) => {
      if (mode === "signin") {
        check(await signIn.emailCode.verifyCode({ code }));
        if (signIn.status !== "complete") throw new Error("That sign-in needs another step this app doesn't support yet.");
        check(await signIn.finalize());
      } else {
        check(await signUp.verifications.verifyEmailCode({ code }));
        if (signUp.status !== "complete") {
          const missing = signUp.missingFields?.join(", ");
          throw new Error(missing ? `Clerk still needs: ${missing}.` : "Couldn't finish creating your account.");
        }
        check(await signUp.finalize());
      }
    },
    [signIn, signUp],
  );

  const resend = useCallback(
    async (mode: "signin" | "signup") => {
      check(mode === "signin" ? await signIn.emailCode.sendCode() : await signUp.verifications.sendEmailCode());
    },
    [signIn, signUp],
  );

  return { start, createAccount, verify, resend };
}

export function useGoogle() {
  const { startSSOFlow } = useSSO();
  return useCallback(async () => {
    const { createdSessionId, setActive } = await startSSOFlow({
      strategy: "oauth_google",
      redirectUrl: AuthSession.makeRedirectUri({ scheme: "wali", path: "sso-callback" }),
    });
    if (createdSessionId && setActive) await setActive({ session: createdSessionId });
    return !!createdSessionId;
  }, [startSSOFlow]);
}
