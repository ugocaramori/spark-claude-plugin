// Renders each view in a minimal MCP Apps host (Playwright) against the real
// server in mock mode and writes screenshots: node scripts/preview.mjs [outDir] [light|dark]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally or via npm i -D playwright
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve(import.meta.dirname, "..");
const out = path.resolve(process.argv[2] ?? "preview");
const theme = process.argv[3] ?? "light";
fs.mkdirSync(out, { recursive: true });

const client = new Client({ name: "preview-host", version: "0" });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [path.join(DIR, "dist/index.js")],
  env: { ...process.env, SPARK_UI_MOCK: "1" },
}));
const html = (await client.readResource({ uri: "ui://spark/app.html" })).contents[0].text;
const log = [];
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

const browser = await chromium.launch();
async function show(name, tool, args, steps = async () => {}) {
  const page = await browser.newPage({ viewport: { width: 680, height: 640 }, colorScheme: theme });
  page.on("pageerror", (e) => console.error(name, "pageerror", e.message));
  await page.exposeFunction("callTool", (n, a) => client.callTool({ name: n, arguments: a }));
  await page.exposeFunction("hostLog", (m) => log.push(`${name}: ${m}`));
  const result = await client.callTool({ name: tool, arguments: args });
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
  await frame.locator("header").first().waitFor();
  await steps(frame, page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  await page.close();
}

await show("inbox", "show_inbox", { title: "Inbox" });
await show("inbox-after-archive", "show_inbox", { title: "Inbox" }, async (f) => {
  await f.locator(".row").nth(3).hover();
  await f.locator(".row").nth(3).getByLabel("Archive").click();
  await f.locator(".chip").first().waitFor();
});
await show("thread", "show_inbox", { title: "Inbox" }, async (f) => {
  await f.locator(".row").first().click();
  await f.locator(".msg").first().waitFor();
});
await show("agenda", "show_agenda", { title: "Today" });
await show("draft", "review_draft", { draft: { to: ["alice@acme.co"], subject: "Re: Q3 budget review", body: "Hi Alice,\n\nConfirmed — the marketing line is correct. The 12% increase covers the launch campaign.\n\nSee you tomorrow.", reply_to: "1114" } },
  async (f) => { await f.getByRole("button", { name: "Save draft" }).click(); await f.getByText("Saved · draft").waitFor(); await f.getByRole("button", { name: "Send…" }).click(); });

console.log(log.join("\n"));
await browser.close();
await client.close();
