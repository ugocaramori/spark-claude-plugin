import { z } from "zod";

export const inboxEmail = z.object({
  id: z.string().describe("Spark message ID (from `emails` / `search`)"),
  from: z.string().describe('Sender, e.g. "Alice Martins <alice@acme.co>"'),
  subject: z.string(),
  date: z.string().optional().describe("Display date as Spark shows it"),
  snippet: z.string().optional().describe("One-line preview or your summary"),
  unread: z.boolean().optional(),
  pinned: z.boolean().optional(),
  has_attachment: z.boolean().optional(),
  category: z
    .enum(["priority", "people", "personal", "notification", "newsletter", "invitation", "invitation_response"])
    .optional(),
  account: z.string().optional(),
});
export type InboxEmail = z.infer<typeof inboxEmail>;

export const agendaEvent = z.object({
  id: z.string().optional(),
  title: z.string(),
  start: z.string().describe("ISO-ish local time: yyyy-MM-ddTHH:mm"),
  end: z.string().optional(),
  all_day: z.boolean().optional(),
  location: z.string().optional(),
  attendees: z.array(z.string()).optional(),
  calendar: z.string().optional(),
  conferencing_url: z.string().optional(),
});
export type AgendaEvent = z.infer<typeof agendaEvent>;

export const draftShape = z.object({
  id: z.string().optional().describe("Existing draft ID returned by `draft`; omit for a new one"),
  account: z.string().optional(),
  to: z.array(z.string()).default([]),
  cc: z.array(z.string()).optional(),
  subject: z.string().default(""),
  body: z.string().default("").describe("Markdown body (no sign-off: Spark adds the signature)"),
  reply_to: z.string().optional().describe("Message ID this draft replies to"),
});
export type Draft = z.infer<typeof draftShape>;

/** Triage verbs the UI may trigger. `send` is handled by its own tool. */
export const UI_ACTIONS = [
  "archive", "markAsDone", "markAsSeen", "markAsUnseen", "pin", "unpin",
  "snooze", "moveToTrash", "moveToInbox", "markAsUndone",
] as const;
