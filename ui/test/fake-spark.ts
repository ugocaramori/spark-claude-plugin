// Stand-in for `spark mcp`: echoes calls so tests can assert proxying.
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

const s = new McpServer({ name: "fake-spark", version: "0" });
for (const name of ["thread", "action", "draft"]) {
  s.registerTool(name, { inputSchema: z.object({}).passthrough() }, async (args) => ({
    content: [{ type: "text", text: name === "draft" ? `Draft created.\nID: 777\n${JSON.stringify(args)}` : `${name} ${JSON.stringify(args)}` }],
  }));
}
await s.connect(new StdioServerTransport());
