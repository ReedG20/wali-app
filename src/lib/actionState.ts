import type { Approval, BrowserTask } from "./types";

export type ActionState = "pending" | "running" | "done" | "declined" | "failed";

/**
 * Where an ask stands (same rule as the web app's action-row.tsx). When the ask turned into a
 * browser run, the run decides: an approved browser task is only "done" when the browser itself
 * has finished, and it's "failed" if the run failed, whatever the approval row says.
 */
export function actionState(a: Pick<Approval, "status"> | null, t: Pick<BrowserTask, "status"> | null): ActionState {
  if (t) {
    if (t.status === "starting" || t.status === "running") return "running";
    return t.status === "completed" ? "done" : "failed";
  }
  if (!a) return "done";
  if (a.status === "pending") return "pending";
  if (a.status === "declined") return "declined";
  if (a.status === "failed") return "failed";
  return a.status === "done" ? "done" : "running";
}
