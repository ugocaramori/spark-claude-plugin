// Step 5: render the views with REAL data (not mock mode). Read-only: never clicks archive, save or send.
// Usage (from ui/):  node .real-test/preview-real.mjs <outDir> <inbox.json> <agenda.json> <thread_id> [light|dark]
//   inbox.json  = array of rows matching schemas.ts `inboxEmail`  (mapped from the real `emails` output)
//   agenda.json = array of rows matching schemas.ts `agendaEvent` (mapped from the real `events` output)
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import fs from "node:fs";
import path from "node:path";

const req = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = req("playwright")); } catch { console.error("Playwright missing: run `npm i --no-save playwright && npx playwright install chromium` in ui/"); process.exit(2); }

const [outArg, inboxFile, agendaFile, threadId, theme = "light"] = process.argv.slice(2);
const UI = path.resolve(import.meta.dirname, "..");
const out = path.resolve(outArg);
fs.mkdirSync(out, { recursive: true });
const emails = JSON.parse(fs.readFileSync(inboxFile, "utf8"));
const events = JSON.parse(fs.readFileSync(agendaFile, "utf8"));
const env = { ...process.env };
delete env.SPARK_UI_MOCK;

const client = new Client({ name: "preview-real", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(UI, "dist/index.js")], env, stderr: "inherit" }));
const html = (await client.readResource({ uri: "ui://spark/app.html" })).contents[0].text;
const log = [];
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
const SAFE = new Set(["ui_thread"]); // only read-only app tools may run from the view

const browser = await chromium.launch();
async function show(name, tool, args, steps = async () => {}) {
  const page = await browser.newPage({ viewport: { width: 680, height: 900 }, colorScheme: theme });
  page.on("pageerror", (e) => log.push(`${name}: PAGEERROR ${e.message}`));
  page.on("console", (m) => m.type() === "error" && log.push(`${name}: console.error ${m.text()}`));
  await page.exposeFunction("callTool", async (n, a) => {
    if (!SAFE.has(n)) { log.push(`${name}: BLOCKED view call ${n} ${JSON.stringify(a)}`); return { isError: true, content: [{ type: "text", text: "blocked in preview" }] }; }
    return client.callTool({ name: n, arguments: a });
  });
  await page.exposeFunction("hostLog", (m) => log.push(`${name}: ${m}`));
  const result = await client.callTool({ name: tool, arguments: args });
  fs.writeFileSync(path.join(out, `${name}.result.json`), JSON.stringify(result, null, 2));
  await page.setContent(`<!doctype html><body style="margin:0;background:${theme === "dark" ? "#141414" : "#fff"}">
    <iframe id="f" style="border:0;width:100%;height:100vh"></iframe>
    <script>
      const f = document.getElementById("f");
      f.srcdoc = ${js(html)};
      const post = (m) => f.contentWindow.postMessage({ jsonrpc: "2.0", ...m }, "*");
      window.addEventListener("message", async ({ data: m }) => {
        if (!m || m.jsonrpc !== "2.0" || !m.method) return;
        let result = {};
        if (m.method === "ui/initialize") result = {
          protocolVersion: "2026-01-26", hostInfo: { name: "preview", version: "0" },
          hostCapabilities: { serverTools: {}, openLinks: {}, message: {}, updateModelContext: {} },
          hostContext: { theme: ${JSON.stringify(theme)}, displayMode: "inline" },
        };
        else if (m.method === "ui/notifications/initialized") {
          post({ method: "ui/notifications/tool-result", params: ${js(result)} });
          return;
        } else if (m.method === "tools/call") result = await window.callTool(m.params.name, m.params.arguments);
        else window.hostLog(m.method + " " + JSON.stringify(m.params ?? {}).slice(0, 160));
        if (m.id !== undefined) post({ id: m.id, result });
      });
    </script>`);
  const frame = page.frameLocator("#f");
  try {
    await frame.locator("header").first().waitFor({ timeout: 10000 });
    await steps(frame, page);
  } catch (e) { log.push(`${name}: STEP FAILED ${e.message.split("\n")[0]}`); }
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
  fs.writeFileSync(path.join(out, `${name}.frame.html`), await page.frames()[1]?.content() ?? "");
  await page.close();
}

await show("inbox", "show_inbox", { title: "Unread", emails });
await show("thread", "show_thread", { message_id: threadId }, async (f) => { await f.locator(".msg").first().waitFor({ timeout: 10000 }).catch(() => { throw new Error("no .msg rendered: parseThread found 0 messages in the real thread text"); }); });
await show("inbox-open-thread", "show_inbox", { title: "Unread", emails }, async (f) => {
  await f.locator(".row").first().click();
  await f.locator(".msg").first().waitFor({ timeout: 10000 }).catch(() => { throw new Error("no .msg rendered after opening first row: parseThread found 0 messages"); });
});
await show("agenda", "show_agenda", { title: "Agenda", events });

fs.writeFileSync(path.join(out, "preview-log.txt"), log.join("\n"));
console.log(log.join("\n") || "no view errors logged");
console.log("screenshots in", out);
await browser.close();
await client.close();
