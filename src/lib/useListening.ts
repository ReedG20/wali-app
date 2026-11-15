import { useQuery } from "convex/react";
import { bleStore } from "./ble";
import { api } from "./convex-api";
import { useStoreSelector } from "./store";

/** Listening = this phone has the pendant over Bluetooth, or the account is on a connected pendant stream. */
export function useListening() {
  const link = useStoreSelector(bleStore, (s) => s.link);
  const devices = (useQuery(api.devices.mine) ?? []) as { status: string }[];
  return link === "connected" || devices.some((d) => d.status === "connected");
}
