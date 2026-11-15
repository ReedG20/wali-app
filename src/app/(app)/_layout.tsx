import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { NativeTabs } from "expo-router/native-tabs";
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { WaliMark } from "../../brand";
import { startConnectionWatch } from "../../lib/connection";
import { api } from "../../lib/convex-api";
import { usePushNotifications } from "../../lib/notifications";
import { usePendantLink } from "../../lib/usePendantLink";
import { color, font, type } from "../../theme";
import { ConnectionPill, Loading } from "../../ui";

/** The signed-in app: native tab bar (Liquid Glass on iOS 26+), one stack per tab. */
export default function AppLayout() {
  return (
    <EnsureUser>
      <PendantLink />
      <PushNotifications />
      {/* The tab bar stays put. With minimizeBehavior="onScrollDown" it stayed collapsed to one
          round button after coming back from a scrolled page or closing the keyboard, even at the
          top of a page, and the button sat on top of content. */}
      <NativeTabs
        tintColor={color.ink}
        iconColor={{ default: color.ink3, selected: color.ink }}
        labelStyle={{ default: { fontFamily: font.medium, color: color.ink3 }, selected: { fontFamily: font.medium, color: color.ink } }}
        minimizeBehavior="never"
      >
        <NativeTabs.Trigger name="(home)">
          <NativeTabs.Trigger.Icon sf={{ default: "bubble.left", selected: "bubble.left.fill" }} />
          <NativeTabs.Trigger.Label>wali</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="chats">
          <NativeTabs.Trigger.Icon sf={{ default: "bubble.left.and.bubble.right", selected: "bubble.left.and.bubble.right.fill" }} />
          <NativeTabs.Trigger.Label>Chats</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="transcripts">
          <NativeTabs.Trigger.Icon sf={{ default: "waveform", selected: "waveform" }} />
          <NativeTabs.Trigger.Label>Transcripts</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="memory">
          <NativeTabs.Trigger.Icon sf={{ default: "brain", selected: "brain.fill" }} />
          <NativeTabs.Trigger.Label>Memory</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="settings">
          <NativeTabs.Trigger.Icon sf={{ default: "circle.circle", selected: "circle.circle.fill" }} />
          <NativeTabs.Trigger.Label>Pendant</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
      <ConnectionPill />
    </EnsureUser>
  );
}

function PushNotifications() {
  usePushNotifications();
  return null;
}

function PendantLink() {
  usePendantLink();
  return null;
}

/** Creates the Convex user row (and home thread) on first sign-in, then renders the app. */
function EnsureUser({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const ensure = useMutation(api.users.ensure);
  const started = useRef(false);

  // Reconnect promptly on network changes and foregrounding (src/lib/connection.ts).
  useEffect(() => startConnectionWatch(), []);

  useEffect(() => {
    if (!isAuthenticated || started.current) return;
    started.current = true;
    void ensure({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  }, [isAuthenticated, ensure]);

  if (isLoading || !isAuthenticated || !me) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 18, backgroundColor: color.paper, padding: 32 }}>
        <WaliMark size={36} />
        {!isLoading && !isAuthenticated ? (
          // Usually a token fetch that failed on a bad connection; the client keeps retrying. (If it
          // never clears in development: check the Clerk JWT template "convex" and
          // CLERK_JWT_ISSUER_DOMAIN in Convex.)
          <Text style={[type.secondary, { textAlign: "center", fontSize: 14 }]}>
            wali couldn&apos;t confirm your sign-in yet. This usually clears up once the connection is back.
          </Text>
        ) : (
          <Loading fill={false} />
        )}
      </View>
    );
  }
  return <>{children}</>;
}
