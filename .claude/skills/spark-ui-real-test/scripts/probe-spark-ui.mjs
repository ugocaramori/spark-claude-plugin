// Step 4: exercise spark-ui (ui/dist/index.js) against the real `spark mcp`.
// Usage (from ui/):  node .real-test/probe-spark-ui.mjs <outDir> <thread_id> <unread_harmless_id> <own_email>
// NEVER calls ui_draft_send. The draft it creates is deleted at the end via upstream `draft {delete}`.
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import fs from "node:fs";
import path from "node:path";

const [outArg, threadId, seenId, ownEmail] = process.argv.slice(2);
if (!threadId || !seenId || !ownEmail) {
  console.error("usage: probe-spark-ui.mjs <outDir> <thread_id> <unread_harmless_id> <own_email>");
  process.exit(2);
}
const out = path.resolve(outArg);
fs.mkdirSync(out, { recursive: true });
const UI = path.resolve(import.meta.dirname, "..");
const env = { ...process.env };
delete env.SPARK_UI_MOCK;

const ui = new Client({ name: "spark-ui-real-test", version: "0" });
await ui.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(UI, "dist/index.js")], env, stderr: "inherit" }));

const results = [];
const textOf = (r) => (r?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
async function call(label, name, args, check) {
  if (name === "ui_draft_send") throw new Error("refusing to call ui_draft_send");
  let res, verdict, note = "";
  try {
    res = await ui.callTool({ name, arguments: args });
    verdict = res.isError ? "FAIL" : "PASS";
    if (res.isError) note = textOf(res);
    else if (check) { const c = check(res); if (c) { verdict = "FAIL"; note = c; } }
  } catch (e) { verdict = "FAIL"; note = String(e?.message ?? e); }
  fs.writeFileSync(path.join(out, `spark-ui-${label}.json`), JSON.stringify(res ?? { error: note }, null, 2));
  results.push({ label, tool: name, verdict, note });
  console.log(`${verdict}  ${label}${note ? ` — ${note.slice(0, 300)}` : ""}`);
  return res;
}

await call("show_thread", "show_thread", { message_id: threadId },
  (r) => (typeof r.structuredContent?.raw === "string" && r.structuredContent.raw.length ? "" : "structuredContent.raw missing/empty"));
await call("ui_thread", "ui_thread", { message_id: threadId },
  (r) => (typeof r.structuredContent?.raw === "string" && r.structuredContent.raw.length ? "" : "structuredContent.raw missing/empty"));
await call("ui_action-markAsSeen", "ui_action", { action_name: "markAsSeen", message_ids: [seenId] });
await call("ui_action-markAsUnseen", "ui_action", { action_name: "markAsUnseen", message_ids: [seenId] });
const draft = await call("ui_draft_save", "ui_draft_save", { to: [ownEmail], subject: "spark-ui test", body: "test" },
  (r) => (r.structuredContent?.id ? "" : `structuredContent.id not extracted; raw: ${r.structuredContent?.raw}`));
await ui.close();

// Clean up the draft with the upstream tool.
const draftId = draft?.structuredContent?.id;
if (draftId) {
  const up = new Client({ name: "spark-ui-real-test-cleanup", version: "0" });
  await up.connect(new StdioClientTransport({ command: process.env.SPARK_CLI ?? "spark", args: ["mcp"], env, stderr: "inherit" }));
  try {
    const del = await up.callTool({ name: "draft", arguments: { delete: draftId } });
    fs.writeFileSync(path.join(out, "upstream-draft-delete.json"), JSON.stringify(del, null, 2));
    results.push({ label: "cleanup draft delete", tool: "draft", verdict: del.isError ? "FAIL" : "PASS", note: textOf(del) });
    console.log(`${del.isError ? "FAIL" : "PASS"}  cleanup draft delete — ${textOf(del).slice(0, 200)}`);
  } catch (e) {
    results.push({ label: "cleanup draft delete", tool: "draft", verdict: "FAIL", note: String(e?.message ?? e) });
    console.log(`FAIL  cleanup draft delete — ${e?.message ?? e}  (DELETE DRAFT ${draftId} MANUALLY)`);
  }
  await up.close();
} else {
  console.log("No draft ID extracted: check Spark Drafts for a 'spark-ui test' draft and delete it by hand.");
}
fs.writeFileSync(path.join(out, "spark-ui-results.json"), JSON.stringify(results, null, 2));
