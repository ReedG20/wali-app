import { getFunctionName } from "convex/server";
type Handler = (name: string, args: Record<string, unknown>) => Promise<unknown>;
const g = globalThis as typeof globalThis & { __convexMutation?: Handler };
export class ConvexHttpClient {
  constructor(_url: string) {}
  mutation(ref: unknown, args: Record<string, unknown>) {
    const h = g.__convexMutation;
    if (!h) return Promise.reject(new Error("no convex handler"));
    return h(getFunctionName(ref as never), args);
  }
}
