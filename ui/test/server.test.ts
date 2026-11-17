import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const DIR = path.resolve(import.meta.dirname, "..");

async function connect(env: Record<string, string>) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [path.join(DIR, "dist/index.js")],
    env: { ...(process.env as Record<string, string>), ...env },
  }));
  return client;
}
const text = (r: any) => r.content.map((c: any) => c.text).join("\n");

test("mock mode: views, visibility and resource", async () => {
  const c = await connect({ SPARK_UI_MOCK: "1" });
  try {
    const { tools } = await c.listTools();
    const vis = Object.fromEntries(tools.map((t: any) => [t.name, t._meta?.ui?.visibility ?? ["model", "app"]]));
    for (const n of ["show_inbox", "show_thread", "show_agenda", "review_draft"]) assert.ok(vis[n].includes("model"), n);
    for (const n of ["ui_thread", "ui_action", "ui_draft_save", "ui_draft_send"]) assert.deepEqual(vis[n], ["app"], n);
    assert.ok(tools.every((t: any) => t._meta?.ui?.resourceUri === "ui://spark/app.html"));

    const inbox: any = await c.callTool({ name: "show_inbox", arguments: {} });
    assert.equal(inbox.structuredContent.view, "inbox");
    assert.ok(inbox.structuredContent.emails.length > 0);
    assert.match(text(inbox), /Alice/); // text fallback for non-UI hosts

    const res = await c.readResource({ uri: "ui://spark/app.html" });
    assert.equal(res.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.match((res.contents[0] as any).text, /<html/);

    const bad: any = await c.callTool({ name: "ui_action", arguments: { action_name: "send", message_ids: ["1"] } });
    assert.ok(bad.isError, "send must not be reachable through ui_action");
  } finally { await c.close(); }
});

test("upstream mode proxies to `spark mcp`", async () => {
  const c = await connect({ SPARK_CLI: path.join(DIR, "test/fake-spark.sh") });
  try {
    const noData: any = await c.callTool({ name: "show_inbox", arguments: {} });
    assert.ok(noData.isError, "real mode needs emails from the model");

    const th: any = await c.callTool({ name: "show_thread", arguments: { message_id: "42" } });
    assert.match(text(th), /thread \{"message_id":"42"\}/);

    const act: any = await c.callTool({ name: "ui_action", arguments: { action_name: "snooze", message_ids: ["1", "2"], date: "2026-11-18T09:00" } });
    assert.match(text(act), /"action_name":"snooze".*"date":"2026-11-18T09:00"/);

    const saved: any = await c.callTool({ name: "ui_draft_save", arguments: { to: ["a@b.co"], subject: "Hi", body: "Yo", reply_to: "9" } });
    assert.equal(saved.structuredContent.id, "777");
    assert.match(text(saved), /"reply_to":"9"/);

    const edited: any = await c.callTool({ name: "ui_draft_save", arguments: { id: "777", to: ["a@b.co"], subject: "Hi", body: "Yo2", reply_to: "9" } });
    assert.match(text(edited), /"edit":"777"/);
    assert.doesNotMatch(text(edited), /reply_to/);

    const sent: any = await c.callTool({ name: "ui_draft_send", arguments: { id: "777" } });
    assert.match(text(sent), /action \{"action_name":"send","message_ids":\["777"\]\}/);
  } finally { await c.close(); }
});
