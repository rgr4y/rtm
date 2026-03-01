# docs-search

Fast, local full-text search for any project's documentation. Point it at a GitHub repo, and it pulls down the markdown, indexes every section with SQLite FTS5, and gives you instant search from the terminal, an HTTP API, or an MCP server your AI tools can talk to.

## Why

Documentation lives in repos. Searching it means context-switching to a browser, waiting for GitHub's search, and losing your flow. `docs-search` keeps a local, searchable copy of any project's docs — one command to ingest, instant results from your terminal.

## Install

```bash
git clone https://github.com/rgr4y/docs-search.git
cd docs-search
npm install && npm run build
npm link   # makes `docs-search` available globally
```

## Quick start

```bash
# Add a source (any public GitHub repo with markdown docs)
docs-search add react facebook/react -p docs/

# Pull and index the docs
docs-search ingest -s react -v

# Search
docs-search "concurrent rendering"
```

That's it. Results come back with highlighted snippets, section headings, and file paths.

## How it works

1. **Ingest** fetches the repo tree via the GitHub API, downloads every `.md` file under the docs prefix, and saves them locally to `~/.local/docs-search/<source>/`
2. Each file is split by headings into sections
3. Sections are indexed into SQLite with [FTS5](https://www.sqlite.org/fts5.html) using the `porter unicode61` tokenizer — the same stemming and Unicode handling you'd get from a dedicated search engine, in a single file
4. **Search** runs FTS5 `MATCH` queries with ranked results and highlighted snippets

## Usage

### Search

```bash
# Bare query (no subcommand needed)
docs-search "hooks lifecycle"

# Scope to a source
docs-search search "routing" -s nextjs

# JSON output for scripting
docs-search search "middleware" --json

# Limit results
docs-search search "state management" -n 5
```

### Manage sources

```bash
# Add a source
docs-search add <name> <owner/repo> [-b branch] [-p docs-prefix]

# Examples
docs-search add nextjs vercel/next.js -p docs/
docs-search add django django/django -p docs/ -b main
docs-search add myproject myorg/myproject -p documentation/

# Remove a source
docs-search remove nextjs

# Switch default source for searches
docs-search use django

# See all configured sources
docs-search config
```

### Ingest

```bash
# Ingest all sources
docs-search ingest -v

# Ingest one source
docs-search ingest -s react -v

# Include non-English docs
docs-search ingest --all-langs
```

### Read a full section

```bash
# Get a section by its ID (shown in search results)
docs-search get 42
```

### List indexed sections

```bash
docs-search list
docs-search list -l en -n 100
```

## MCP server

Run as an [MCP](https://modelcontextprotocol.io/) stdio server so AI tools can search your docs:

```bash
docs-search mcp
```

Exposes four tools: `search`, `get_document`, `list_sources`, `list_documents`.

Add it to any MCP-compatible client. Example for a `config.toml`:

```toml
[mcp]
enabled = true

[[mcp.servers]]
name = "docs-search"
command = "docs-search"
args = ["mcp"]
```

Or for Claude Code's `settings.json`:

```json
{
  "mcpServers": {
    "docs-search": {
      "command": "docs-search",
      "args": ["mcp"]
    }
  }
}
```

## HTTP server

For network access or integration with other tools:

```bash
docs-search serve -p 3777
```

JSON-RPC endpoint at `POST /rpc`:

```bash
curl -s http://localhost:3777/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"search","params":{"query":"authentication"}}' | jq
```

Methods: `search`, `get_document`, `list_documents`.

## Configuration

Config lives at `~/.local/docs-search/config.json`. Downloaded docs and the search database are stored alongside it. You can edit it directly or use the CLI commands above.

```json
{
  "sources": [
    {
      "name": "react",
      "repo": "facebook/react",
      "branch": "main",
      "docsPrefix": "docs/"
    }
  ],
  "dataDir": "/home/you/.local/docs-search",
  "lastSource": "react"
}
```

Set `GITHUB_TOKEN` for private repos or to avoid rate limits:

```bash
export GITHUB_TOKEN=ghp_...
```

## Stack

- **[SQLite FTS5](https://www.sqlite.org/fts5.html)** — full-text search with porter stemming
- **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** — synchronous, fast SQLite bindings
- **[Commander](https://github.com/tj/commander.js)** — CLI framework
- **[Hono](https://hono.dev/)** — lightweight HTTP server
- **[@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)** — MCP server implementation

## License

ISC
