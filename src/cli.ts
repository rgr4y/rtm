#!/usr/bin/env node
import { Command } from "commander";
import { ingest } from "./ingest";
import { startServer } from "./server";
import { startMcp } from "./mcp";
import { openDb, search, getDocument, listDocuments } from "./db";
import {
  loadConfig, getConfigPath, getDbPath, getDefaultSource,
  addSource, removeSource, setLastSource, isGlobal,
} from "./config";
import path from "path";

const config = loadConfig();
const defaultDb = getDbPath(config);

const program = new Command();

program
  .name("docs-search")
  .description("SQLite FTS5 search tool for documentation")
  .version("0.0.1");

program
  .command("ingest")
  .description("Fetch and index docs from configured GitHub sources")
  .option("-d, --db <path>", "SQLite database path", defaultDb)
  .option("-s, --source <name>", "Ingest only this source")
  .option("--all-langs", "Index all languages, not just English", false)
  .option("-v, --verbose", "Verbose output", false)
  .action(async (opts) => {
    const result = await ingest({
      dbPath: opts.db,
      source: opts.source,
      allLangs: opts.allLangs,
      verbose: opts.verbose,
    });
    // Update last source if a specific one was ingested
    if (opts.source) {
      setLastSource(opts.source);
    }
    console.log(
      `Indexed ${result.filesProcessed} files (${result.sectionsInserted} sections).`
    );
  });

program
  .command("serve")
  .description("Start the JSON-RPC HTTP server")
  .option("-d, --db <path>", "SQLite database path", defaultDb)
  .option("-p, --port <number>", "Port to listen on", "3777")
  .action((opts) => {
    startServer({ dbPath: opts.db, port: parseInt(opts.port, 10) });
  });

program
  .command("mcp")
  .description("Start as an MCP server over stdio")
  .option("-d, --db <path>", "SQLite database path", defaultDb)
  .action((opts) => {
    startMcp({ dbPath: opts.db });
  });

program
  .command("search <query>")
  .description("Search the docs index")
  .option("-d, --db <path>", "SQLite database path", defaultDb)
  .option("-s, --source <name>", "Search only this source")
  .option("-l, --lang <language>", "Filter by language")
  .option("-n, --limit <number>", "Max results", "10")
  .option("--json", "Output raw JSON", false)
  .action((query, opts) => {
    const cfg = loadConfig();
    const db = openDb(opts.db);

    // Determine source scope: explicit flag > lastSource > all
    const sourceName = opts.source ?? getDefaultSource(cfg);

    const { results, total } = search(db, query, {
      language: opts.lang,
      limit: parseInt(opts.limit, 10),
      sourcePrefix: sourceName ? `${sourceName}/` : undefined,
    });
    db.close();
    if (opts.json) {
      console.log(JSON.stringify({ results, total }, null, 2));
      return;
    }
    if (results.length === 0) {
      console.log("No results found.");
      return;
    }
    for (const r of results) {
      const fullPath = path.join(cfg.dataDir, r.file_path);
      const snippet = r.snippet.replace(/<\/?mark>/g, (m) => m === "<mark>" ? "\x1b[1;33m" : "\x1b[0m");
      console.log(`\x1b[36m[${r.id}]\x1b[0m \x1b[1m${r.heading}\x1b[0m`);
      console.log(`     ${fullPath} (${r.language})`);
      console.log(`     ${snippet}`);
      console.log();
    }
    if (sourceName) {
      console.log(`${results.length} of ${total} match(es) [source: ${sourceName}]`);
    } else {
      console.log(`${results.length} of ${total} match(es)`);
    }
  });

program
  .command("get <id>")
  .description("Get a document section by ID")
  .option("-d, --db <path>", "SQLite database path", defaultDb)
  .option("--json", "Output raw JSON", false)
  .action((id, opts) => {
    const db = openDb(opts.db);
    const doc = getDocument(db, parseInt(id, 10));
    db.close();
    if (!doc) {
      console.error(`Document ${id} not found.`);
      process.exit(1);
    }
    if (opts.json) {
      console.log(JSON.stringify(doc, null, 2));
      return;
    }
    const cfg = loadConfig();
    const fullPath = path.join(cfg.dataDir, doc.file_path);
    console.log(`\x1b[1m${doc.heading}\x1b[0m`);
    console.log(`${fullPath} (${doc.language})`);
    console.log();
    console.log(doc.content);
  });

program
  .command("list")
  .description("List indexed documents")
  .option("-d, --db <path>", "SQLite database path", defaultDb)
  .option("-l, --lang <language>", "Filter by language")
  .option("-n, --limit <number>", "Max results", "50")
  .option("-o, --offset <number>", "Offset", "0")
  .option("--json", "Output raw JSON", false)
  .action((opts) => {
    const db = openDb(opts.db);
    const result = listDocuments(db, {
      language: opts.lang,
      limit: parseInt(opts.limit, 10),
      offset: parseInt(opts.offset, 10),
    });
    db.close();
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const cfg = loadConfig();
    for (const d of result.docs) {
      const fullPath = path.join(cfg.dataDir, d.file_path);
      console.log(`\x1b[36m[${d.id}]\x1b[0m ${fullPath} — ${d.heading} (${d.language})`);
    }
    console.log(`\nShowing ${result.docs.length} of ${result.total} total sections`);
  });

program
  .command("add <name> <repo>")
  .description("Add a GitHub repo as a doc source (repo = owner/repo)")
  .option("-b, --branch <branch>", "Branch to index", "main")
  .option("-p, --prefix <prefix>", "Path prefix for docs in the repo", "docs/")
  .action((name, repo, opts) => {
    addSource({ name, repo, branch: opts.branch, docsPrefix: opts.prefix });
    console.log(`Added source "${name}" → ${repo}@${opts.branch} (prefix: ${opts.prefix})`);
    console.log(`Run \`docs-search ingest -s ${name}\` to index it.`);
  });

program
  .command("remove <name>")
  .description("Remove a doc source")
  .action((name) => {
    if (removeSource(name)) {
      console.log(`Removed source "${name}".`);
    } else {
      console.error(`Source "${name}" not found.`);
      process.exit(1);
    }
  });

program
  .command("use <name>")
  .description("Set the default source for searches")
  .action((name) => {
    const cfg = loadConfig();
    if (!cfg.sources.some((s) => s.name === name)) {
      const available = cfg.sources.map((s) => s.name).join(", ");
      console.error(`Source "${name}" not found. Available: ${available}`);
      process.exit(1);
    }
    setLastSource(name);
    console.log(`Default source set to "${name}".`);
  });

program
  .command("config")
  .description("Show config file path and contents")
  .action(() => {
    const cfg = loadConfig();
    console.log(`Config:  ${getConfigPath()}`);
    console.log(`Data:    ${cfg.dataDir}`);
    console.log(`Install: ${isGlobal() ? "global (/usr/local)" : "local (~/.local)"}`);
    console.log(`Default: ${getDefaultSource(cfg) ?? "(none)"}`);
    console.log();
    console.log(`Sources (${cfg.sources.length}):`);
    for (const s of cfg.sources) {
      const marker = s.name === getDefaultSource(cfg) ? " *" : "";
      console.log(`  - ${s.name}: ${s.repo}@${s.branch ?? "main"} (prefix: ${s.docsPrefix ?? "docs/"})${marker}`);
    }
  });

// Default: bare args with no subcommand → search
const knownCommands = ["ingest", "serve", "mcp", "search", "get", "list", "add", "remove", "use", "config", "help"];
const firstArg = process.argv[2];
if (firstArg && !firstArg.startsWith("-") && !knownCommands.includes(firstArg)) {
  process.argv.splice(2, 0, "search");
}

program.parse();
