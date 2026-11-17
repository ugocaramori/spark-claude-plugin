/** stdio entry point: `node dist/index.js` (the plugin's .mcp.json runs this). */
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";

createServer()
  .connect(new StdioServerTransport())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
