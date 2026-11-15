import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { bleStore } from "./ble";
import { api } from "./convex-api";
import { useStoreSelector } from "./store";

type Device = { _id: string; name: string; status: "connected" | "disconnected" };

/**
 * When this phone connects to a pendant over Bluetooth, subscribe the signed-in account to the
 * pendant stream (the web app's "Connect pendant"), so wali starts reading what it hears.
 * Disconnecting the account stays a deliberate choice on the Pendant tab.
 */
export function usePendantLink() {
  // Select only what this needs: it is mounted for the whole session, and Status updates every 2 s.
  const link = useStoreSelector(bleStore, (s) => s.link);
  const deviceId = useStoreSelector(bleStore, (s) => s.deviceId);
  const deviceName = useStoreSelector(bleStore, (s) => s.deviceName);
  const devices = useQuery(api.devices.mine) as Device[] | undefined;
  const connect = useMutation(api.devices.connect);
  const done = useRef<string | null>(null);

  useEffect(() => {
    if (link !== "connected" || !devices || !deviceId) return;
    if (devices.some((d) => d.status === "connected")) return;
    if (done.current === deviceId) return;
    done.current = deviceId;
    void connect({ name: deviceName ?? "wali pendant" });
  }, [link, deviceId, deviceName, devices, connect]);
}
