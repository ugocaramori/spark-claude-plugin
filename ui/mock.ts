/** Canned Spark data for SPARK_UI_MOCK=1 (demos, screenshots, tests). */
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { AgendaEvent, InboxEmail } from "./schemas.js";

const today = () => new Date().toISOString().slice(0, 10);

export function sampleInbox(): InboxEmail[] {
  return [
    { id: "1114", from: "Alice Martins <alice@acme.co>", subject: "Q3 budget review — numbers attached", date: "09:12", snippet: "Hi! Sharing the final spreadsheet before tomorrow's review. Can you confirm the marketing line?", unread: true, category: "priority", has_attachment: true },
    { id: "1113", from: "Bruno Lima <bruno@acme.co>", subject: "Re: Launch checklist", date: "08:47", snippet: "Done with the QA pass, only the pricing page copy is pending.", unread: true, category: "people" },
    { id: "1110", from: "Calendar <calendar@acme.co>", subject: "Invitation: Design sync @ Thu 15:00", date: "Yesterday", snippet: "Carla invited you to Design sync.", category: "invitation" },
    { id: "1107", from: "GitHub <noreply@github.com>", subject: "[acme/web] PR #482 approved", date: "Yesterday", snippet: "dani approved these changes.", category: "notification" },
    { id: "1102", from: "Product Weekly <hello@productweekly.io>", subject: "The 5 onboarding patterns that convert", date: "Mon", snippet: "This week: progressive disclosure, empty states and more.", category: "newsletter" },
    { id: "1098", from: "Diego Souza <diego@client.com>", subject: "Contract renewal", date: "Mon", snippet: "Could we jump on a call this week to discuss the renewal terms?", pinned: true, category: "people" },
  ];
}

/** Events placed around the current time so the "now" line and live state show. */
export function sampleEvents(): AgendaEvent[] {
  const base = new Date();
  base.setMinutes(0, 0, 0);
  const at = (h: number, m = 0) => {
    const d = new Date(base.getTime() + (h * 60 + m) * 60_000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  return [
    { id: "e1", title: "Daily standup", start: at(-2), end: at(-2, 15), calendar: "Work", conferencing_url: "https://meet.example.com/standup" },
    { id: "e2", title: "Q3 budget review", start: at(0), end: at(1), location: "Room 4B", attendees: ["alice@acme.co", "bruno@acme.co"], calendar: "Work", conferencing_url: "https://meet.example.com/q3" },
    { id: "e3", title: "Call with Diego — renewal", start: at(1, 30), end: at(2), attendees: ["diego@client.com"], calendar: "Clients", conferencing_url: "https://meet.example.com/diego" },
    { id: "e4", title: "Focus: launch copy", start: at(2, 30), end: at(4), calendar: "Personal" },
  ];
}

const THREADS: Record<string, string> = {
  "1114": `Thread: Q3 budget review — numbers attached (2 messages)

From: Bruno Lima <bruno@acme.co>
Date: ${today()} 08:02
Subject: Q3 budget review

Alice, can you send the final numbers before the review?

---
From: Alice Martins <alice@acme.co>
Date: ${today()} 09:12
Subject: Re: Q3 budget review — numbers attached

Hi! Sharing the final spreadsheet before tomorrow's review.
Can you confirm the marketing line? It went up 12% vs. Q2.

Thanks,
Alice

Attachments:
| ID | Name | Size | MIME Type |
| 42 | q3-budget.xlsx | 84 KB | application/vnd.ms-excel |`,
};

export function mockCall(name: string, args: Record<string, unknown>): CallToolResult {
  const text = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }] });
  switch (name) {
    case "thread": {
      const id = String(args.message_id);
      const e = sampleInbox().find((m) => m.id === id);
      return text(
        THREADS[id] ??
          `Thread: ${e?.subject ?? "(unknown)"} (1 message)\n\nFrom: ${e?.from ?? "unknown"}\nDate: ${e?.date ?? ""}\n\n${e?.snippet ?? "No body."}`,
      );
    }
    case "action":
      return text(`${args.action_name}: ${(args.message_ids as string[]).length} message(s) updated.`);
    case "draft": {
      const id = (args.edit as string) ?? "9001";
      return text(`Draft ${args.edit ? "updated" : "created"}.\nID: ${id}\nSubject: ${args.subject ?? ""}\nBody:\n${args.body ?? ""}`);
    }
    default:
      return { isError: true, content: [{ type: "text", text: `mock: tool ${name} not implemented` }] };
  }
}
