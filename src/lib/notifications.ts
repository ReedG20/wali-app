import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { convex } from "./convex";
import { api } from "./convex-api";

/**
 * Push notifications. The backend (convex/push.ts) sends one through Expo's push service whenever
 * wali speaks on its own: a nudge, something waiting for an OK, or background work finishing.
 * Approval notifications carry Approve / Decline actions (long-press, or pull down on the lock screen).
 */

type PushData = { kind?: string; threadId?: string; messageId?: string; approvalId?: string; home?: string };

/** The thread on screen right now, so its own notifications don't banner over it. */
let activeThread: string | null = null;
export function setActiveThread(id: string | null) {
  activeThread = id;
}

Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const data = n.request.content.data as PushData;
    const looking = !!data.threadId && data.threadId === activeThread && AppState.currentState === "active";
    return { shouldShowBanner: !looking, shouldShowList: true, shouldPlaySound: !looking, shouldSetBadge: false };
  },
});

const APPROVE = "approve";
const DECLINE = "decline";
let categoriesReady: Promise<unknown> | null = null;
function ensureCategories() {
  // Identifiers can't contain ":" or "-". Both actions open the app so the signed-in session makes the call.
  categoriesReady ??= Notifications.setNotificationCategoryAsync("approval", [
    { identifier: APPROVE, buttonTitle: "Approve", options: { opensAppToForeground: true, isAuthenticationRequired: true } },
    { identifier: DECLINE, buttonTitle: "Decline", options: { opensAppToForeground: true, isDestructive: true } },
  ]).catch(() => null);
  return categoriesReady;
}

export type PushPermission = "granted" | "denied" | "undetermined" | "unsupported";

export async function pushPermission(): Promise<PushPermission> {
  if (Platform.OS !== "ios") return "unsupported";
  const p = await Notifications.getPermissionsAsync();
  if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return "granted";
  return p.canAskAgain ? "undetermined" : "denied";
}

let currentToken: string | null = null;

/** Ask (if we still can), then fetch this install's Expo push token. Null when not allowed. */
export async function requestPushToken(ask: boolean): Promise<string | null> {
  if (Platform.OS !== "ios") return null;
  await ensureCategories();
  let status = await pushPermission();
  if (status === "undetermined" && ask) {
    const r = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
    status = r.granted ? "granted" : "denied";
  }
  if (status !== "granted") return null;
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  // Without the APNs entitlement (e.g. unsigned Simulator builds) iOS never answers; don't wait forever.
  const { data } = await Promise.race([
    Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Apple didn't hand this phone a push token. Push needs a signed build on a real iPhone.")), 20_000)),
  ]);
  currentToken = data;
  return data;
}

/** Call before signing out so this phone stops getting the account's notifications. */
export async function forgetPushToken() {
  if (!currentToken) return;
  try {
    await convex.mutation(api.push.unregister, { token: currentToken });
  } catch {
    // Signing out anyway; a stale token is dropped the first time Expo reports it unregistered.
  }
  currentToken = null;
}

function openThread(data: PushData) {
  if (!data.threadId) return;
  if (data.home === "1") router.navigate("/(app)/(home)");
  else router.navigate({ pathname: "/(app)/chats/[id]", params: { id: data.threadId } });
}

const handled = new Set<string>();
/** The Expo push token this launch already registered with the backend. */
let savedToken: string | null = null;

/**
 * Mounted once inside the signed-in app: registers this phone (asking for permission the first
 * time), keeps the token fresh, and acts on taps and Approve / Decline.
 */
export function usePushNotifications() {
  const register = useMutation(api.push.register);
  const decide = useMutation(api.approvals.decide);
  const last = Notifications.useLastNotificationResponse();
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    const save = (token: string) => {
      // Once per token per launch: the row only needs to exist, and every call is a write.
      if (token === savedToken) return;
      savedToken = token;
      register({ token, platform: "ios", deviceName: Device.deviceName ?? Device.modelName ?? undefined }).catch(() => {
        savedToken = null;
      });
    };
    requestPushToken(true)
      .then((t) => t && save(t))
      .catch((e) => console.warn("[push] no token:", e instanceof Error ? e.message : e));
    // APNs can rotate the device token; re-register when it does. Asking for a token fires this
    // listener too (expo-notifications registers with APNs on every getExpoPushTokenAsync), so
    // reacting to every event re-asked, which fired it again: about three push.register calls a
    // second, forever. They queued ahead of everything else the app sent ("Sending…" that never
    // finished), and the backlog stalled the socket ("Reconnecting…" every few seconds). Only a
    // device token different from the one already seen counts as a rotation.
    let deviceToken: string | null = null;
    const sub = Notifications.addPushTokenListener((t) => {
      const value = typeof t.data === "string" ? t.data : JSON.stringify(t.data);
      const rotated = deviceToken !== null && value !== deviceToken;
      deviceToken = value;
      if (rotated) requestPushToken(false).then((tok) => tok && save(tok)).catch(() => {});
    });
    return () => sub.remove();
  }, [register]);

  useEffect(() => {
    if (!last) return;
    const key = `${last.notification.request.identifier}:${last.actionIdentifier}`;
    if (handled.has(key)) return;
    handled.add(key);
    const data = last.notification.request.content.data as PushData;
    const action = last.actionIdentifier;
    if ((action === APPROVE || action === DECLINE) && data.approvalId) {
      decide({ id: data.approvalId as never, decision: action === APPROVE ? "approve" : "decline" }).catch(() => {
        // Already decided elsewhere: just show the thread.
      });
    }
    openThread(data);
    void Notifications.clearLastNotificationResponseAsync();
  }, [last, decide]);
}
