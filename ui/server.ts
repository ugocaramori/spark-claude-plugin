/**
 * spark-ui — MCP Apps layer for the Spark plugin.
 *
 * Model-visible tools render interactive views (ui://spark/app.html):
 *   show_inbox   – triage list (archive / done / pin / snooze, open thread)
 *   show_thread  – full conversation with reply hand-off to Claude
 *   show_agenda  – day timeline with "join" links
 *   review_draft – editable draft with Save and an explicit Send button
 *
 * App-only tools (visibility ["app"]) are what the view calls when the user
 * clicks something; they proxy to the upstream `spark mcp` tools.
 */
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer, type CallToolResult, type ReadResourceResult } from "@modelcontextprotocol/server";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createBackend, errorResult, textOf, type SparkBackend } from "./backend.js";
import { sampleEvents, sampleInbox } from "./mock.js";
import { agendaEvent, draftShape, inboxEmail, UI_ACTIONS } from "./schemas.js";

const SERVER_FILE = fileURLToPath(import.meta.url);
const DIST_DIR = SERVER_FILE.endsWith(".ts") ? path.join(path.dirname(SERVER_FILE), "dist") : path.dirname(SERVER_FILE);
const RESOURCE_URI = "ui://spark/app.html";
const ui = { resourceUri: RESOURCE_URI };
const appOnly = { resourceUri: RESOURCE_URI, visibility: ["app"] as ("app" | "model")[] };

export function createServer(backend: SparkBackend = createBackend()): McpServer {
  const server = new McpServer({ name: "spark-ui", version: "0.1.0" });

  // ---------------------------------------------------------------- views
  registerAppTool(server, "show_inbox", {
    title: "Show Spark inbox",
    description:
      "Render an interactive Spark inbox the user can triage (archive, mark done, pin, snooze, open threads). " +
      "First fetch messages with the spark `emails` or `search` tool, then pass them here as structured rows. " +
      "Prefer this over a markdown table whenever you list more than a couple of emails.",
    inputSchema: z.object({
      title: z.string().optional().describe('Heading, e.g. "Priority — unread"'),
      emails: z.array(inboxEmail).optional(),
    }),
    _meta: { ui },
  }, async ({ title, emails }): Promise<CallToolResult> => {
    const rows = emails ?? (backend.mode === "mock" ? sampleInbox() : undefined);
    if (!rows) return errorResult("Pass `emails`: call the spark `emails` or `search` tool first and map its rows.");
    const text = rows.length
      ? rows.map((e) => `- [${e.id}] ${e.unread ? "● " : ""}${e.from} — ${e.subject}`).join("\n")
      : "Inbox is empty.";
    return {
      content: [{ type: "text", text: `${title ?? "Inbox"} (${rows.length})\n${text}` }],
      structuredContent: { view: "inbox", title: title ?? "Inbox", emails: rows },
    };
  });

  registerAppTool(server, "show_thread", {
    title: "Show Spark thread",
    description: "Render a full Spark conversation with quick actions and a 'reply with Claude' hand-off.",
    inputSchema: z.object({ message_id: z.string() }),
    _meta: { ui },
  }, async ({ message_id }): Promise<CallToolResult> => {
    const res = await backend.call("thread", { message_id });
    if (res.isError) return res;
    const raw = textOf(res);
    return { content: [{ type: "text", text: raw }], structuredContent: { view: "thread", message_id, raw } };
  });

  registerAppTool(server, "show_agenda", {
    title: "Show Spark agenda",
    description:
      "Render a day/week agenda timeline. Fetch events with the spark `events` tool first and pass them here. " +
      "Use for meeting prep, morning briefings and calendar audits.",
    inputSchema: z.object({
      title: z.string().optional(),
      events: z.array(agendaEvent).optional(),
    }),
    _meta: { ui },
  }, async ({ title, events }): Promise<CallToolResult> => {
    const rows = events ?? (backend.mode === "mock" ? sampleEvents() : undefined);
    if (!rows) return errorResult("Pass `events`: call the spark `events` tool first and map its rows.");
    const text = rows.map((e) => `- ${e.start}${e.end ? `–${e.end.slice(-5)}` : ""} ${e.title}`).join("\n");
    return {
      content: [{ type: "text", text: `${title ?? "Agenda"}\n${text || "No events."}` }],
      structuredContent: { view: "agenda", title: title ?? "Agenda", events: rows },
    };
  });

  registerAppTool(server, "review_draft", {
    title: "Review draft",
    description:
      "Show a draft for the user to review and edit before it is saved or sent. Nothing is sent unless the user " +
      "presses Send in the view. Pass the draft ID if you already created it with the spark `draft` tool.",
    inputSchema: z.object({ draft: draftShape }),
    _meta: { ui },
  }, async ({ draft }): Promise<CallToolResult> => ({
    content: [{ type: "text", text: `Draft for review — To: ${draft.to.join(", ")}\nSubject: ${draft.subject}\n\n${draft.body}` }],
    structuredContent: { view: "draft", draft },
  }));

  // ------------------------------------------------------ app-only actions
  registerAppTool(server, "ui_thread", {
    description: "Load a thread for the view.",
    inputSchema: z.object({ message_id: z.string() }),
    _meta: { ui: appOnly },
  }, async ({ message_id }) => {
    const res = await backend.call("thread", { message_id });
    return res.isError ? res : { ...res, structuredContent: { raw: textOf(res) } };
  });

  registerAppTool(server, "ui_action", {
    description: "Apply a triage action chosen by the user in the view.",
    inputSchema: z.object({
      action_name: z.enum(UI_ACTIONS),
      message_ids: z.array(z.string()).min(1),
      date: z.string().optional(),
    }),
    _meta: { ui: appOnly },
  }, async (args) => backend.call("action", args));

  registerAppTool(server, "ui_draft_save", {
    description: "Create or update a draft from the view.",
    inputSchema: draftShape,
    _meta: { ui: appOnly },
  }, async (d) => {
    const args: Record<string, unknown> = { to: d.to, subject: d.subject, body: d.body };
    if (d.cc?.length) args.cc = d.cc;
    if (d.account) args.account = d.account;
    if (d.id) args.edit = d.id;
    else if (d.reply_to) args.reply_to = d.reply_to;
    const res = await backend.call("draft", args);
    if (res.isError) return res;
    const raw = textOf(res);
    const id = d.id ?? /\bID:\s*(\S+)/i.exec(raw)?.[1];
    return { ...res, structuredContent: { id, raw } };
  });

  registerAppTool(server, "ui_draft_send", {
    description: "Send a saved draft. Only called after the user presses Send and confirms.",
    inputSchema: z.object({ id: z.string(), date: z.string().optional() }),
    _meta: { ui: appOnly },
  }, async ({ id, date }) => backend.call("action", { action_name: "send", message_ids: [id], ...(date ? { date } : {}) }));

  // ------------------------------------------------------------ resource
  registerAppResource(server, RESOURCE_URI, RESOURCE_URI, { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => ({
      contents: [{
        uri: RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: await fs.readFile(path.join(DIST_DIR, "app.html"), "utf-8"),
        _meta: { ui: { prefersBorder: false } },
      }],
    }));

  return server;
}
