import { useMutation } from "convex/react";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useCallback } from "react";
import { api } from "./convex-api";

export function useNewChat() {
  const create = useMutation(api.threads.create);
  return useCallback(async () => {
    void Haptics.selectionAsync();
    const id = (await create({})) as string;
    router.push({ pathname: "/(app)/chats/[id]", params: { id } });
  }, [create]);
}
