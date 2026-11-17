/**
 * Backend that talks to the Spark CLI's own MCP server (`spark mcp`).
 *
 * The spark-ui server never re-implements Spark: every read and write goes to
 * the upstream tools (`thread`, `action`, `draft`, ...) so access levels
 * (read-only / triage / send) configured in Spark Desktop still apply.
 *
 * Set SPARK_UI_MOCK=1 to use canned data instead (demos and tests only).
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { mockCall } from "./mock.js";

export interface SparkBackend {
  readonly mode: "upstream" | "mock";
  call(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
}

class UpstreamBackend implements SparkBackend {
  readonly mode = "upstream" as const;
  private client: Promise<Client> | null = null;

  private connect(): Promise<Client> {
    if (!this.client) {
      const command = process.env.SPARK_CLI ?? "spark";
      const client = new Client({ name: "spark-ui", version: "0.1.0" });
      const transport = new StdioClientTransport({
        command,
        args: ["mcp"],
        env: process.env as Record<string, string>,
      });
      this.client = client.connect(transport).then(() => client);
      // Retry on the next call instead of caching a failed connection.
      this.client.catch(() => (this.client = null));
    }
    return this.client;
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    let client: Client;
    try {
      client = await this.connect();
    } catch (e) {
      return errorResult(
        `Could not start the Spark CLI (\`${process.env.SPARK_CLI ?? "spark"} mcp\`): ${(e as Error).message}. ` +
          "Enable it in Spark Desktop under Settings → AI Agents → Spark CLI Setup.",
      );
    }
    return (await client.callTool({ name, arguments: args })) as CallToolResult;
  }
}

class MockBackend implements SparkBackend {
  readonly mode = "mock" as const;
  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return mockCall(name, args);
  }
}

export function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

export function textOf(result: CallToolResult): string {
  return result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

export function createBackend(): SparkBackend {
  return process.env.SPARK_UI_MOCK === "1" ? new MockBackend() : new UpstreamBackend();
}
