import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { NativeTabs } from "expo-router/native-tabs";
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { WaliMark } from "../../brand";
import { api } from "../../lib/convex-api";
import { usePushNotifications } from "../../lib/notifications";
import { usePendantLink } from "../../lib/usePendantLink";
import { color, font, type } from "../../theme";
import { Spinner } from "../../ui";

/** The signed-in app: native tab bar (Liquid Glass on iOS 26+), one stack per tab. */
export default function AppLayout() {
  return (
    <EnsureUser>
      <PendantLink />
      <PushNotifications />
      <NativeTabs
        tintColor={color.ink}
        iconColor={{ default: color.ink3, selected: color.ink }}
        labelStyle={{ default: { fontFamily: font.medium, color: color.ink3 }, selected: { fontFamily: font.medium, color: color.ink } }}
        minimizeBehavior="onScrollDown"
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
          <Text style={[type.secondary, { textAlign: "center", fontSize: 14 }]}>
            Signed in, but the backend didn&apos;t accept the session yet. Check the Clerk JWT template &ldquo;convex&rdquo; and
            CLERK_JWT_ISSUER_DOMAIN in Convex.
          </Text>
        ) : (
          <Spinner />
        )}
      </View>
    );
  }
  return <>{children}</>;
}
