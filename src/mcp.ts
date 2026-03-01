import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb, search, getDocument, listDocuments } from "./db";
import { loadConfig, getDbPath, getDefaultSource } from "./config";
import path from "path";

export async function startMcp(opts: { dbPath?: string }): Promise<void> {
  const config = loadConfig();
  const dbPath = opts.dbPath ?? getDbPath(config);
  const db = openDb(dbPath);

  const server = new McpServer({
    name: "docs-search",
    version: "0.0.1",
  });

  server.registerTool(
    "search",
    {
      title: "Search docs",
      description: "Full-text search across indexed documentation. Returns matching sections with snippets.",
      inputSchema: {
        query: z.string().describe("Search query"),
        source: z.string().optional().describe("Source name to scope search (default: last used source)"),
        language: z.string().optional().describe("Filter by language code (e.g. 'en')"),
        limit: z.number().optional().describe("Max results (default: 10)"),
      },
    },
    async ({ query, source, language, limit }) => {
      const cfg = loadConfig();
      const sourceName = source ?? getDefaultSource(cfg);
      const { results, total } = search(db, query, {
        language,
        limit: limit ?? 10,
        sourcePrefix: sourceName ? `${sourceName}/` : undefined,
      });

      const text = results.length === 0
        ? "No results found."
        : results.map((r) => {
            const fullPath = path.join(cfg.dataDir, r.file_path);
            const clean = r.snippet.replace(/<\/?mark>/g, "");
            return `[${r.id}] ${r.heading}\n  ${fullPath}\n  ${clean}`;
          }).join("\n\n") + `\n\n${results.length} of ${total} match(es)`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  server.registerTool(
    "get_document",
    {
      title: "Get document",
      description: "Retrieve a full document section by its ID.",
      inputSchema: {
        id: z.number().describe("Document section ID"),
      },
    },
    async ({ id }) => {
      const doc = getDocument(db, id);
      if (!doc) {
        return { content: [{ type: "text" as const, text: `Document ${id} not found.` }] };
      }
      const cfg = loadConfig();
      const fullPath = path.join(cfg.dataDir, doc.file_path);
      return {
        content: [{
          type: "text" as const,
          text: `# ${doc.heading}\n${fullPath} (${doc.language})\n\n${doc.content}`,
        }],
      };
    }
  );

  server.registerTool(
    "list_sources",
    {
      title: "List sources",
      description: "List configured documentation sources.",
      inputSchema: {},
    },
    async () => {
      const cfg = loadConfig();
      const defaultSrc = getDefaultSource(cfg);
      const lines = cfg.sources.map((s) => {
        const marker = s.name === defaultSrc ? " (default)" : "";
        return `- ${s.name}: ${s.repo}@${s.branch ?? "main"}${marker}`;
      });
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "list_documents",
    {
      title: "List documents",
      description: "List indexed document sections.",
      inputSchema: {
        language: z.string().optional().describe("Filter by language"),
        limit: z.number().optional().describe("Max results (default: 50)"),
        offset: z.number().optional().describe("Offset for pagination"),
      },
    },
    async ({ language, limit, offset }) => {
      const result = listDocuments(db, {
        language,
        limit: limit ?? 50,
        offset: offset ?? 0,
      });
      const cfg = loadConfig();
      const lines = result.docs.map((d) => {
        const fullPath = path.join(cfg.dataDir, d.file_path);
        return `[${d.id}] ${fullPath} — ${d.heading}`;
      });
      const text = lines.join("\n") + `\n\n${result.docs.length} of ${result.total} total`;
      return { content: [{ type: "text" as const, text }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("docs-search MCP server running on stdio");
}
