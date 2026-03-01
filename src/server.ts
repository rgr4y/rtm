import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { openDb, search, getDocument, listDocuments } from "./db";
import type Database from "better-sqlite3";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function rpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function handleRpc(db: Database.Database, req: JsonRpcRequest): JsonRpcResponse {
  const { id, method, params } = req;

  switch (method) {
    case "search": {
      const query = params?.query;
      if (typeof query !== "string" || query.trim().length === 0) {
        return rpcError(id, -32602, "params.query is required and must be a non-empty string");
      }
      const language = typeof params?.language === "string" ? params.language : undefined;
      const limit = typeof params?.limit === "number" ? params.limit : undefined;
      const { results, total } = search(db, query, { language, limit });
      return rpcResult(id, { results, total, count: results.length });
    }

    case "get_document": {
      const docId = params?.id;
      if (typeof docId !== "number") {
        return rpcError(id, -32602, "params.id is required and must be a number");
      }
      const doc = getDocument(db, docId);
      if (!doc) {
        return rpcError(id, -32602, `Document with id ${docId} not found`);
      }
      return rpcResult(id, doc);
    }

    case "list_documents": {
      const language = typeof params?.language === "string" ? params.language : undefined;
      const limit = typeof params?.limit === "number" ? params.limit : undefined;
      const offset = typeof params?.offset === "number" ? params.offset : undefined;
      const result = listDocuments(db, { language, limit, offset });
      return rpcResult(id, result);
    }

    default:
      return rpcError(id, -32601, `Method '${method}' not found`);
  }
}

export function createApp(db: Database.Database): Hono {
  const app = new Hono();

  app.post("/rpc", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(rpcError(null, -32700, "Parse error"), 200);
    }

    // Batch support
    if (Array.isArray(body)) {
      const responses = body.map((req) => {
        if (!isValidRequest(req)) {
          return rpcError(req?.id ?? null, -32600, "Invalid JSON-RPC request");
        }
        return handleRpc(db, req);
      });
      return c.json(responses, 200);
    }

    if (!isValidRequest(body)) {
      return c.json(
        rpcError((body as any)?.id ?? null, -32600, "Invalid JSON-RPC request"),
        200
      );
    }

    return c.json(handleRpc(db, body), 200);
  });

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}

function isValidRequest(obj: unknown): obj is JsonRpcRequest {
  if (typeof obj !== "object" || obj === null) return false;
  const r = obj as Record<string, unknown>;
  return r.jsonrpc === "2.0" && typeof r.method === "string";
}

import net from "net";

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

export async function startServer(opts: { dbPath?: string; port?: number }): Promise<void> {
  const port = opts.port ?? 3777;

  if (await isPortInUse(port)) {
    console.error(`Port ${port} is already in use. Another instance may be running.`);
    process.exit(1);
  }

  const db = openDb(opts.dbPath);
  const app = createApp(db);

  serve({ fetch: app.fetch, port }, () => {
    console.log(`docs-search server listening on http://localhost:${port}`);
    console.log(`JSON-RPC endpoint: POST http://localhost:${port}/rpc`);
  });
}
