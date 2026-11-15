import type { GenericId as Id } from "convex/values"

export type ToolPart = {
  toolCallId: string
  toolName: string
  args?: unknown
  result?: unknown
  state: "running" | "done" | "error"
}

export type Approval = {
  _id: Id<"approvals">
  channel: "composio" | "browser"
  title: string
  summary: string
  toolSlug?: string
  args: unknown
  /** read: changes nothing. low: a private, reversible change. high: reaches people, money, deletes. */
  risk?: "read" | "low" | "high"
  /** Present when this can be allowed for good ("Always allow"); never for high-risk actions. */
  scope?: { kind: "browser" | "app"; key: string; label: string }
  status: "pending" | "approved" | "declined" | "running" | "done" | "failed"
  error?: string
  createdAt: number
}

export type BrowserTask = {
  _id: Id<"browserTasks">
  task: string
  /** One plain sentence for the user; `task` is the brief the browser agent was given. */
  summary?: string
  /** Live view of the run's browser: set once it's up, cleared when the run ends. */
  liveUrl?: string
  status: "starting" | "running" | "completed" | "failed" | "cancelled"
  result?: string
  error?: string
}

export type Message = {
  _id: Id<"messages">
  threadId: Id<"threads">
  role: "user" | "assistant"
  kind: "text" | "nudge" | "approval" | "update"
  status: "streaming" | "done" | "error"
  text: string
  tools?: ToolPart[]
  trigger?: { kind: string }
  actions?: string[]
  response?: "helpful" | "dismissed"
  chosenAction?: string
  error?: string
  createdAt: number
  approval: Approval | null
  browserTask: BrowserTask | null
  /** Client only: shown optimistically while messages.send is still on its way. */
  pending?: boolean
}

export type Thread = {
  _id: Id<"threads">
  title: string
  kind: "home" | "chat"
  updatedAt: number
  preview?: string
}

export type GateEvent = {
  _id: Id<"gateEvents">
  trigger: { kind: string }
  excerpt: string
  passed: boolean
  reason: string
  scores?: {
    worthActing: number
    userAsked: number
    canHelp?: number
    distress: number
    badTime: number
    urgency: number
    kind: string
  }
  decision?: string
  costUsd?: number
  createdAt: number
}

/** An "Always allow" the user granted on an approval (users.me.alwaysAllow). */
export type Grant = { kind: "browser" | "app"; key: string; label: string; createdAt: number }
