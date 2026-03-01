# rtm

**Read the Manual.** Fast, local full-text search for any project's documentation.

Point it at a GitHub repo, and it pulls down the markdown, indexes every section with SQLite FTS5, and gives you instant search from the terminal, an HTTP API, or an MCP server your AI tools can talk to.

## Why

Documentation lives in repos. Searching it means context-switching to a browser, waiting for GitHub's search, and losing your flow. `rtm` keeps a local, searchable copy of any project's docs — one command to ingest, instant results from your terminal.

## Install

```bash
git clone https://github.com/rgr4y/docs-search.git
cd docs-search
npm install && npm run build
npm link   # makes `rtm` available globally
```

## Quick start

```bash
# Add a source (any public GitHub repo with markdown docs)
rtm add react facebook/react -p docs/

# Pull and index the docs
rtm ingest -s react -v

# Search
rtm "concurrent rendering"
```

That's it. Results come back with highlighted snippets, section headings, and file paths.

## How it works

1. **Ingest** fetches the repo tree via the GitHub API, downloads every `.md` file under the docs prefix, and saves them locally to `~/.local/rtm/<source>/`
2. Each file is split by headings into sections
3. Sections are indexed into SQLite with [FTS5](https://www.sqlite.org/fts5.html) using the `porter unicode61` tokenizer — the same stemming and Unicode handling you'd get from a dedicated search engine, in a single file
4. **Search** runs FTS5 `MATCH` queries with ranked results and highlighted snippets

## Usage

### Search

```bash
# Bare query (no subcommand needed)
rtm "hooks lifecycle"

# Scope to a source
rtm search "routing" -s nextjs

# JSON output for scripting
rtm search "middleware" --json

# Limit results
rtm search "state management" -n 5
```

### Manage sources

```bash
# Add a source
rtm add <name> <owner/repo> [-b branch] [-p docs-prefix]

# Examples
rtm add nextjs vercel/next.js -p docs/
rtm add django django/django -p docs/ -b main
rtm add myproject myorg/myproject -p documentation/

# Remove a source
rtm remove nextjs

# Switch default source for searches
rtm use django

# See all configured sources
rtm config
```

### Ingest

```bash
# Ingest all sources
rtm ingest -v

# Ingest one source
rtm ingest -s react -v

# Include non-English docs
rtm ingest --all-langs
```

### Read a full section

```bash
# Get a section by its ID (shown in search results)
rtm get 42
```

### List indexed sections

```bash
rtm list
rtm list -l en -n 100
```

## MCP server

Run as an [MCP](https://modelcontextprotocol.io/) stdio server so AI tools can search your docs:

```bash
rtm mcp
```

Exposes four tools: `search`, `get_document`, `list_sources`, `list_documents`.

Add it to any MCP-compatible client. Example for a `config.toml`:

```toml
[mcp]
enabled = true

[[mcp.servers]]
name = "rtm"
command = "rtm"
args = ["mcp"]
```

Or for Claude Code's `settings.json`:

```json
{
  "mcpServers": {
    "rtm": {
      "command": "rtm",
      "args": ["mcp"]
    }
  }
}
```

## HTTP server

For network access or integration with other tools:

```bash
rtm serve -p 3777
```

JSON-RPC endpoint at `POST /rpc`:

```bash
curl -s http://localhost:3777/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"search","params":{"query":"authentication"}}' | jq
```

Methods: `search`, `get_document`, `list_documents`.

## Configuration

Config lives at `~/.local/rtm/config.json`. Downloaded docs and the search database are stored alongside it. You can edit it directly or use the CLI commands above.

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
  "dataDir": "/home/you/.local/rtm",
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
