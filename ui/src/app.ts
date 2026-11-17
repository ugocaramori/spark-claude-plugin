/**
 * Spark MCP App view. One bundle renders four views, chosen by the
 * `view` field of the tool result's structuredContent.
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";
import "./global.css";
import "./app.css";

// ------------------------------------------------------------------ types
type Category = "priority" | "people" | "personal" | "notification" | "newsletter" | "invitation" | "invitation_response";
interface Email {
  id: string; from: string; subject: string; date?: string; snippet?: string;
  unread?: boolean; pinned?: boolean; has_attachment?: boolean; category?: Category; account?: string;
}
interface Event {
  id?: string; title: string; start: string; end?: string; all_day?: boolean; location?: string;
  attendees?: string[]; calendar?: string; conferencing_url?: string;
}
interface Draft { id?: string; account?: string; to: string[]; cc?: string[]; subject: string; body: string; reply_to?: string }
type Payload =
  | { view: "inbox"; title: string; emails: Email[] }
  | { view: "thread"; message_id: string; raw: string }
  | { view: "agenda"; title: string; events: Event[] }
  | { view: "draft"; draft: Draft };

// ---------------------------------------------------------------- helpers
const root = document.getElementById("root")!;
const toastEl = document.getElementById("toast")!;

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c != null && c !== false) el.append(c);
  return el;
}

function senderName(from: string): string {
  const m = /^\s*"?([^"<]+?)"?\s*<.+>/.exec(from);
  return (m?.[1] ?? from.split("@")[0]).trim();
}
function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\s]/gu, "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}
function hue(s: string): number {
  let x = 0;
  for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) % 360;
  return x;
}
function avatar(name: string) {
  return h("span", { class: "avatar", style: `--h:${hue(name)}`, "aria-hidden": "true" }, initials(name));
}
function resultText(r: CallToolResult): string {
  return r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n").trim();
}

let toastTimer: number | undefined;
function toast(msg: string, undo?: () => void, isError = false) {
  toastEl.replaceChildren(h("span", {}, msg));
  if (undo) toastEl.append(h("button", { class: "link", onclick: () => { toastEl.classList.remove("show"); undo(); } }, "Undo"));
  toastEl.classList.toggle("error", isError);
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 5000);
}

async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult | null> {
  try {
    const r = await app.callServerTool({ name, arguments: args });
    if (r.isError) {
      toast(resultText(r) || "Spark refused the action", undefined, true);
      return null;
    }
    return r;
  } catch (e) {
    toast(`Could not reach Spark: ${(e as Error).message}`, undefined, true);
    return null;
  }
}

/** Keep the model aware of what the user did in the view (no new turn). */
function tellModel(text: string) {
  app.updateModelContext({ content: [{ type: "text", text }] }).catch(() => {});
}
function askClaude(text: string) {
  app.sendMessage({ role: "user", content: [{ type: "text", text }] }).catch(() => {});
}

function tomorrowAt9(): string {
  const d = new Date(Date.now() + 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
}

// ------------------------------------------------------------------ inbox
const CATEGORY_LABEL: Record<Category, string> = {
  priority: "Priority", people: "People", personal: "People", notification: "Notifications",
  newsletter: "Newsletters", invitation: "Invitations", invitation_response: "Invitations",
};

const ACTIONS = {
  markAsDone: { label: "Done", past: "Marked done", undo: "markAsUndone", removes: true, icon: "✓" },
  archive: { label: "Archive", past: "Archived", undo: "moveToInbox", removes: true, icon: "▣" },
  pin: { label: "Pin", past: "Pinned", undo: "unpin", removes: false, icon: "★" },
  snooze: { label: "Snooze until tomorrow 9:00", past: "Snoozed until tomorrow", undo: null, removes: true, icon: "◷" },
} as const;
type ActionKey = keyof typeof ACTIONS;

function renderInbox(p: Extract<Payload, { view: "inbox" }>) {
  let emails = [...p.emails];
  const selected = new Set<string>();
  let filter: string = "all";

  const listEl = h("ul", { class: "list", role: "list" });
  const batchEl = h("div", { class: "batch", hidden: true });
  const chipsEl = h("div", { class: "chips", role: "tablist" });
  const countEl = h("span", { class: "count" });

  async function apply(action: ActionKey, ids: string[]) {
    const spec = ACTIONS[action];
    const before = emails;
    if (spec.removes) emails = emails.filter((e) => !ids.includes(e.id));
    else emails = emails.map((e) => (ids.includes(e.id) ? { ...e, pinned: true } : e));
    ids.forEach((id) => selected.delete(id));
    draw();
    const r = await callTool("ui_action", {
      action_name: action, message_ids: ids, ...(action === "snooze" ? { date: tomorrowAt9() } : {}),
    });
    if (!r) { emails = before; draw(); return; }
    const subj = before.filter((e) => ids.includes(e.id)).map((e) => `"${e.subject}"`).join(", ");
    tellModel(`User ${spec.past.toLowerCase()} in the Spark view: ${subj} (ids ${ids.join(", ")}).`);
    toast(`${spec.past} ${ids.length > 1 ? `${ids.length} emails` : "1 email"}`, spec.undo ? async () => {
      if (await callTool("ui_action", { action_name: spec.undo, message_ids: ids })) {
        emails = before; draw();
        tellModel(`User undid "${spec.past.toLowerCase()}" for ids ${ids.join(", ")}.`);
      }
    } : undefined);
  }

  function row(e: Email) {
    const name = senderName(e.from);
    const check = h("input", {
      type: "checkbox", class: "check", "aria-label": `Select ${e.subject}`,
      onclick: (ev: MouseEvent) => ev.stopPropagation(),
      onchange: (ev: globalThis.Event) => {
        (ev.target as HTMLInputElement).checked ? selected.add(e.id) : selected.delete(e.id);
        drawBatch();
      },
    });
    check.checked = selected.has(e.id);
    const actions = h("div", { class: "row-actions" },
      ...(Object.keys(ACTIONS) as ActionKey[])
        .filter((k) => !(k === "pin" && e.pinned))
        .map((k) => h("button", {
          class: "icon", title: ACTIONS[k].label, "aria-label": ACTIONS[k].label,
          onclick: (ev: MouseEvent) => { ev.stopPropagation(); apply(k, [e.id]); },
        }, ACTIONS[k].icon)),
    );
    return h("li", {
      class: `row${e.unread ? " unread" : ""}`, tabindex: "0",
      onclick: () => openThread(e.id, e.subject, () => renderInbox({ ...p, emails })),
      onkeydown: (ev: KeyboardEvent) => {
        if (ev.key === "Enter") openThread(e.id, e.subject, () => renderInbox({ ...p, emails }));
        if (ev.key === "e") apply("archive", [e.id]);
        if (ev.key === "d") apply("markAsDone", [e.id]);
      },
    },
      check,
      avatar(name),
      h("div", { class: "row-main" },
        h("div", { class: "row-top" },
          h("span", { class: "sender" }, name),
          e.pinned ? h("span", { class: "pin", title: "Pinned" }, "★") : null,
          e.has_attachment ? h("span", { class: "clip", title: "Attachment" }, "📎") : null,
          h("span", { class: "date" }, e.date ?? ""),
        ),
        h("div", { class: "subject" }, e.subject),
        e.snippet ? h("div", { class: "snippet" }, e.snippet) : null,
      ),
      actions,
    );
  }

  function drawChips() {
    const cats = new Map<string, number>();
    for (const e of emails) if (e.category) {
      const l = CATEGORY_LABEL[e.category];
      cats.set(l, (cats.get(l) ?? 0) + 1);
    }
    const all = [["all", emails.length] as const, ...cats.entries()];
    chipsEl.replaceChildren(...(cats.size > 1 ? all : []).map(([label, n]) =>
      h("button", {
        class: `chip${filter === label ? " on" : ""}`, role: "tab", "aria-selected": String(filter === label),
        onclick: () => { filter = label; draw(); },
      }, label === "all" ? "All" : label, h("span", { class: "chip-n" }, String(n))),
    ));
  }

  function drawBatch() {
    batchEl.hidden = selected.size === 0;
    batchEl.replaceChildren(
      h("span", {}, `${selected.size} selected`),
      ...(["markAsDone", "archive", "snooze"] as ActionKey[]).map((k) =>
        h("button", { class: "btn small", onclick: () => apply(k, [...selected]) }, ACTIONS[k].label.split(" ")[0])),
      h("button", { class: "btn small ghost", onclick: () => { selected.clear(); draw(); } }, "Clear"),
    );
  }

  function draw() {
    if (filter !== "all" && !emails.some((e) => e.category && CATEGORY_LABEL[e.category] === filter)) filter = "all";
    const visible = emails.filter((e) => filter === "all" || (e.category && CATEGORY_LABEL[e.category] === filter));
    const unread = emails.filter((e) => e.unread).length;
    countEl.textContent = unread ? `${unread} unread · ${emails.length}` : `${emails.length}`;
    drawChips();
    listEl.replaceChildren(...visible.map(row));
    if (!emails.length) listEl.replaceChildren(h("li", { class: "empty" }, h("div", { class: "empty-mark" }, "✓"), "All clear. Nothing left here."));
    drawBatch();
  }

  root.replaceChildren(
    h("header", { class: "bar" }, h("h1", {}, p.title), countEl),
    chipsEl, batchEl, listEl,
    h("p", { class: "hint" }, "Click to open · e archive · d done"),
  );
  draw();
}

// ----------------------------------------------------------------- thread
interface Msg { from?: string; date?: string; body: string; files: { id: string; name: string; size: string }[] }
function parseThread(raw: string): { title: string; msgs: Msg[] } {
  const [head, ...rest] = raw.split(/\n-{3,}\n/);
  const first = head.split("\n");
  const title = /^Thread:\s*(.*?)(\s*\(\d+ messages?\))?$/.exec(first[0] ?? "")?.[1] ?? "Conversation";
  const blocks = [first.slice(1).join("\n"), ...rest];
  const msgs = blocks.map((b) => {
    const m: Msg = { body: "", files: [] };
    const lines = b.trim().split("\n");
    let i = 0;
    for (; i < lines.length; i++) {
      const kv = /^(From|Date|To|Cc|Subject|Reply-To):\s*(.*)$/.exec(lines[i]);
      if (!kv) break;
      if (kv[1] === "From") m.from = kv[2];
      if (kv[1] === "Date") m.date = kv[2];
    }
    let body = lines.slice(i).join("\n");
    const att = /\n?Attachments:\s*\n((?:\|.*\|\s*\n?)+)/.exec(body);
    if (att) {
      for (const line of att[1].trim().split("\n")) {
        const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
        if (cells.length >= 3 && /^\d+$/.test(cells[0])) m.files.push({ id: cells[0], name: cells[1], size: cells[2] });
      }
      body = body.replace(att[0], "");
    }
    m.body = body.trim();
    return m;
  }).filter((m) => m.from || m.body);
  return { title, msgs };
}

function renderThread(id: string, raw: string, back?: () => void, fallbackTitle?: string) {
  const { title, msgs } = parseThread(raw);
  const doAction = async (action: "archive" | "markAsDone") => {
    if (await callTool("ui_action", { action_name: action, message_ids: [id] })) {
      tellModel(`User ${action === "archive" ? "archived" : "marked done"} thread ${id} ("${title}") in the Spark view.`);
      toast(action === "archive" ? "Archived" : "Marked done");
      back?.();
    }
  };
  root.replaceChildren(
    h("header", { class: "bar" },
      back ? h("button", { class: "btn ghost small", onclick: back, "aria-label": "Back to list" }, "← Back") : null,
      h("h1", { class: "grow" }, title === "Conversation" && fallbackTitle ? fallbackTitle : title),
    ),
    h("div", { class: "toolbar" },
      h("button", { class: "btn primary", onclick: () => askClaude(`Draft a reply to the latest message in Spark thread ${id} ("${title}") and show it to me with review_draft.`) }, "Reply with Claude"),
      h("button", { class: "btn", onclick: () => askClaude(`Summarize Spark thread ${id} ("${title}") and list any action items for me.`) }, "Summarize"),
      h("span", { class: "grow" }),
      h("button", { class: "btn ghost", onclick: () => doAction("markAsDone") }, "✓ Done"),
      h("button", { class: "btn ghost", onclick: () => doAction("archive") }, "Archive"),
    ),
    h("div", { class: "messages" }, ...msgs.map((m, i) => {
      const name = senderName(m.from ?? "Unknown");
      const card = h("details", { class: "msg", open: i >= msgs.length - 2 },
        h("summary", {}, avatar(name), h("span", { class: "sender" }, name), h("span", { class: "date" }, m.date ?? "")),
        h("pre", { class: "body" }, m.body),
        m.files.length ? h("div", { class: "files" }, ...m.files.map((f) =>
          h("button", { class: "file", title: "Ask Claude to read this attachment",
            onclick: () => askClaude(`Read attachment ${f.id} (${f.name}) from Spark thread ${id} and tell me what matters in it.`) },
            "📎 ", f.name, h("small", {}, f.size)))) : null,
      );
      return card;
    })),
  );
}

async function openThread(id: string, subject: string, back: () => void) {
  root.replaceChildren(h("header", { class: "bar" }, h("h1", {}, subject)), h("div", { class: "skeleton" }), h("div", { class: "skeleton short" }));
  const r = await callTool("ui_thread", { message_id: id });
  if (!r) return back();
  renderThread(id, (r.structuredContent as { raw?: string })?.raw ?? resultText(r), back, subject);
}

// ----------------------------------------------------------------- agenda
function parseTime(s: string): Date { return new Date(s.length <= 10 ? `${s}T00:00` : s); }
function hhmm(d: Date) { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function renderAgenda(p: Extract<Payload, { view: "agenda" }>) {
  const events = [...p.events].sort((a, b) => parseTime(a.start).getTime() - parseTime(b.start).getTime());
  const now = Date.now();
  let nowPlaced = false;
  const items: HTMLElement[] = [];
  let lastDay = "";
  for (const e of events) {
    const s = parseTime(e.start), en = e.end ? parseTime(e.end) : null;
    const day = s.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
    if (day !== lastDay) { items.push(h("li", { class: "day" }, day)); lastDay = day; }
    if (!nowPlaced && s.getTime() > now) {
      items.push(h("li", { class: "now", "aria-label": "Now" }, h("span", {}, `Now · ${hhmm(new Date())}`)));
      nowPlaced = true;
    }
    const live = en && s.getTime() <= now && now < en.getTime();
    const past = (en ?? s).getTime() < now;
    items.push(h("li", { class: `event${live ? " live" : ""}${past ? " past" : ""}`, style: `--h:${hue(e.calendar ?? "x")}` },
      h("div", { class: "when" }, e.all_day ? "All day" : hhmm(s), en && !e.all_day ? h("small", {}, hhmm(en)) : null),
      h("div", { class: "ev-main" },
        h("div", { class: "ev-title" }, e.title, live ? h("span", { class: "badge" }, "Now") : null),
        h("div", { class: "ev-meta" }, [e.location, e.calendar, e.attendees?.length ? plural(e.attendees.length, "guest") : ""].filter(Boolean).join(" · ")),
      ),
      h("div", { class: "ev-actions" },
        e.conferencing_url && !past ? h("button", { class: `btn small${live ? " primary" : ""}`, onclick: () => app.openLink({ url: e.conferencing_url! }) }, "Join") : null,
        !past ? h("button", { class: "btn small ghost", onclick: () => askClaude(`Prepare me for "${e.title}" (${e.start}): find related email threads in Spark, open questions, and who is attending.`) }, "Prep") : null,
      ),
    ));
  }
  const busy = events.reduce((acc, e) => acc + (e.end && !e.all_day ? parseTime(e.end).getTime() - parseTime(e.start).getTime() : 0), 0);
  root.replaceChildren(
    h("header", { class: "bar" }, h("h1", {}, p.title), h("span", { class: "count" }, `${plural(events.length, "event")} · ${Math.round(busy / 360_000) / 10}h booked`)),
    h("ul", { class: "agenda", role: "list" }, ...(items.length ? items : [h("li", { class: "empty" }, "Nothing scheduled.")])),
  );
}

// ------------------------------------------------------------------ draft
function renderDraft(p: Extract<Payload, { view: "draft" }>) {
  let draft = { ...p.draft };
  let state: "editing" | "saving" | "confirm" | "sent" = "editing";
  const field = (label: string, input: HTMLElement) => h("label", { class: "field" }, h("span", {}, label), input);
  const toIn = h("input", { type: "text", value: draft.to.join(", "), placeholder: "name@example.com" });
  const ccIn = h("input", { type: "text", value: (draft.cc ?? []).join(", ") });
  const subjIn = h("input", { type: "text", value: draft.subject });
  const bodyIn = h("textarea", { rows: "10" });
  bodyIn.value = draft.body;
  const status = h("span", { class: "status" }, draft.id ? `Draft ${draft.id}` : "Not saved yet");
  const revise = h("input", { type: "text", placeholder: "e.g. shorter, more formal, add a deadline" });
  const sendBtn = h("button", { class: "btn primary" }, "Send…");
  const saveBtn = h("button", { class: "btn" }, "Save draft");
  const split = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

  const read = () => { draft = { ...draft, to: split(toIn.value), cc: split(ccIn.value), subject: subjIn.value, body: bodyIn.value }; };
  const setState = (s: typeof state) => {
    state = s;
    sendBtn.textContent = s === "confirm" ? `Confirm send to ${draft.to.length} recipient${draft.to.length === 1 ? "" : "s"}` : s === "sent" ? "Sent ✓" : "Send…";
    sendBtn.classList.toggle("danger", s === "confirm");
    (sendBtn as HTMLButtonElement).disabled = s === "saving" || s === "sent";
    (saveBtn as HTMLButtonElement).disabled = s === "saving" || s === "sent";
  };

  async function save(): Promise<boolean> {
    read();
    if (!draft.to.length) { toast("Add at least one recipient", undefined, true); return false; }
    setState("saving");
    const r = await callTool("ui_draft_save", draft);
    setState("editing");
    if (!r) return false;
    const id = (r.structuredContent as { id?: string })?.id;
    if (id) draft.id = id;
    status.textContent = `Saved · draft ${draft.id ?? ""}`;
    tellModel(`User edited and saved Spark draft ${draft.id ?? ""}. Current version — To: ${draft.to.join(", ")}; Subject: ${draft.subject}; Body:\n${draft.body}`);
    return true;
  }

  saveBtn.addEventListener("click", async () => { if (await save()) toast("Draft saved in Spark"); });
  sendBtn.addEventListener("click", async () => {
    if (state !== "confirm") { read(); if (draft.to.length) setState("confirm"); else toast("Add at least one recipient", undefined, true); return; }
    if (!(await save()) || !draft.id) return;
    setState("saving");
    const r = await callTool("ui_draft_send", { id: draft.id });
    if (!r) { setState("editing"); return; }
    setState("sent");
    status.textContent = "Sent";
    tellModel(`User sent Spark draft ${draft.id} to ${draft.to.join(", ")} ("${draft.subject}").`);
    toast("Sent");
  });
  for (const el of [toIn, ccIn, subjIn, bodyIn]) el.addEventListener("input", () => state === "confirm" && setState("editing"));

  root.replaceChildren(
    h("header", { class: "bar" }, h("h1", { class: "grow" }, draft.reply_to ? "Reply draft" : "New draft"), status),
    h("div", { class: "form" },
      field("To", toIn), field("Cc", ccIn), field("Subject", subjIn), bodyIn,
      h("p", { class: "hint" }, "Your Spark signature is added automatically."),
    ),
    h("div", { class: "toolbar" }, saveBtn, h("span", { class: "grow" }), sendBtn),
    h("form", {
      class: "revise",
      onsubmit: (ev: SubmitEvent) => {
        ev.preventDefault();
        read();
        if (!revise.value.trim()) return;
        askClaude(`Revise this Spark draft${draft.id ? ` (id ${draft.id})` : ""}: ${revise.value.trim()}\n\nCurrent text:\nSubject: ${draft.subject}\n\n${draft.body}\n\nShow the result with review_draft.`);
        revise.value = "";
      },
    }, revise, h("button", { class: "btn small", type: "submit" }, "Ask Claude")),
  );
}

// ------------------------------------------------------------- lifecycle
function render(payload: Payload | undefined) {
  if (!payload) return;
  switch (payload.view) {
    case "inbox": return renderInbox(payload);
    case "thread": return renderThread(payload.message_id, payload.raw);
    case "agenda": return renderAgenda(payload);
    case "draft": return renderDraft(payload);
  }
}

function onHostContext(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    const s = ctx.safeAreaInsets;
    root.style.padding = `${s.top}px ${s.right}px ${s.bottom}px ${s.left}px`;
  }
}

const app = new App({ name: "Spark", version: "0.1.0" });
app.ontoolinput = () => {
  root.replaceChildren(h("div", { class: "skeleton" }), h("div", { class: "skeleton" }), h("div", { class: "skeleton short" }));
};
app.ontoolresult = (result) => {
  if (result.isError) {
    root.replaceChildren(h("p", { class: "error pad" }, resultText(result as CallToolResult) || "Something went wrong."));
    return;
  }
  render(result.structuredContent as Payload | undefined);
};
app.ontoolcancelled = () => root.replaceChildren(h("p", { class: "muted pad" }, "Cancelled."));
app.onhostcontextchanged = onHostContext;
app.onteardown = async () => ({});
app.onerror = console.error;

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) onHostContext(ctx);
});
