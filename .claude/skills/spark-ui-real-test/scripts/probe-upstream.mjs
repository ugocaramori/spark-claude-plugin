// Step 3: call the real upstream `spark mcp` tools and save their RAW text output.
// Usage (from ui/):  node .real-test/probe-upstream.mjs <outDir> [thread_message_id]
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import fs from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "real-out");
const threadId = process.argv[3];
fs.mkdirSync(out, { recursive: true });
const cli = process.env.SPARK_CLI ?? "spark";

const client = new Client({ name: "spark-ui-real-test", version: "0" });
await client.connect(new StdioClientTransport({ command: cli, args: ["mcp"], env: process.env, stderr: "inherit" }));

const tools = (await client.listTools()).tools;
fs.writeFileSync(path.join(out, "upstream-tools.json"), JSON.stringify(tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema })), null, 2));
console.log("upstream tools:", tools.map((t) => t.name).join(", "));

const calls = threadId
  ? [["thread", { message_id: threadId }]]
  : [["accounts", {}], ["emails", { filter: "is:unread" }], ["events", {}]];

for (const [name, args] of calls) {
  const file = name === "thread" ? `upstream-thread-${threadId}` : `upstream-${name}`;
  try {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    fs.writeFileSync(path.join(out, `${file}.txt`), text);
    fs.writeFileSync(path.join(out, `${file}.json`), JSON.stringify(res, null, 2));
    console.log(`${name}: ${res.isError ? "ERROR" : "ok"} (${text.length} chars) -> ${file}.txt`);
  } catch (e) {
    fs.writeFileSync(path.join(out, `${file}.error.txt`), String(e?.stack ?? e));
    console.log(`${name}: THREW ${e?.message ?? e}`);
  }
}
await client.close();
