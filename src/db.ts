import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

const DEFAULT_DB_PATH = path.join(os.homedir(), ".local", "docs-search", "docs-search.db");

export interface DocSection {
  id: number;
  file_path: string;
  heading: string;
  content: string;
  language: string;
}

export interface SearchResult extends DocSection {
  rank: number;
  snippet: string;
}

export function openDb(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err: any) {
      if (err.code === "EACCES") {
        console.error(
          `Error: No write permission to ${dir}\n` +
          `If installed globally, run with sudo or install locally.`
        );
        process.exit(1);
      }
      throw err;
    }
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      heading TEXT NOT NULL,
      content TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en'
    );

    CREATE INDEX IF NOT EXISTS idx_docs_path ON docs(file_path);
    CREATE INDEX IF NOT EXISTS idx_docs_lang ON docs(language);

    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
      heading,
      content,
      content='docs',
      content_rowid='id',
      tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON docs BEGIN
      INSERT INTO docs_fts(rowid, heading, content)
      VALUES (new.id, new.heading, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON docs BEGIN
      INSERT INTO docs_fts(docs_fts, rowid, heading, content)
      VALUES ('delete', old.id, old.heading, old.content);
    END;

    CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE ON docs BEGIN
      INSERT INTO docs_fts(docs_fts, rowid, heading, content)
      VALUES ('delete', old.id, old.heading, old.content);
      INSERT INTO docs_fts(rowid, heading, content)
      VALUES (new.id, new.heading, new.content);
    END;
  `);
}

export function clearDocs(db: Database.Database): void {
  db.exec("DELETE FROM docs");
}

export function insertSection(
  db: Database.Database,
  section: Omit<DocSection, "id">
): number {
  const stmt = db.prepare(
    "INSERT INTO docs (file_path, heading, content, language) VALUES (?, ?, ?, ?)"
  );
  const result = stmt.run(
    section.file_path,
    section.heading,
    section.content,
    section.language
  );
  return Number(result.lastInsertRowid);
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}

function sanitizeFtsQuery(query: string): string {
  const tokens = query
    .replace(/"/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"`).join(" ");
}

export function search(
  db: Database.Database,
  query: string,
  opts: { language?: string; limit?: number; sourcePrefix?: string } = {}
): SearchResponse {
  const limit = opts.limit ?? 20;
  const ftsQuery = sanitizeFtsQuery(query);

  let countSql = `
    SELECT COUNT(*) as total
    FROM docs_fts
    JOIN docs d ON d.id = docs_fts.rowid
    WHERE docs_fts MATCH ?
  `;
  let sql = `
    SELECT
      d.id, d.file_path, d.heading, d.content, d.language,
      docs_fts.rank AS rank,
      snippet(docs_fts, 1, '<mark>', '</mark>', '...', 40) AS snippet
    FROM docs_fts
    JOIN docs d ON d.id = docs_fts.rowid
    WHERE docs_fts MATCH ?
  `;
  const params: (string | number)[] = [ftsQuery];
  const countParams: (string | number)[] = [ftsQuery];

  if (opts.sourcePrefix) {
    countSql += " AND d.file_path LIKE ?";
    sql += " AND d.file_path LIKE ?";
    params.push(opts.sourcePrefix + "%");
    countParams.push(opts.sourcePrefix + "%");
  }

  if (opts.language) {
    countSql += " AND d.language = ?";
    sql += " AND d.language = ?";
    params.push(opts.language);
    countParams.push(opts.language);
  }

  sql += " ORDER BY docs_fts.rank LIMIT ?";
  params.push(limit);

  const { total } = db.prepare(countSql).get(...countParams) as { total: number };
  const results = db.prepare(sql).all(...params) as SearchResult[];

  return { results, total };
}

export function getDocument(
  db: Database.Database,
  id: number
): DocSection | null {
  return (
    (db.prepare("SELECT * FROM docs WHERE id = ?").get(id) as
      | DocSection
      | undefined) ?? null
  );
}

export function listDocuments(
  db: Database.Database,
  opts: { language?: string; limit?: number; offset?: number } = {}
): { docs: Pick<DocSection, "id" | "file_path" | "heading" | "language">[]; total: number } {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  let countSql = "SELECT COUNT(*) as total FROM docs";
  let sql = "SELECT id, file_path, heading, language FROM docs";
  const params: (string | number)[] = [];
  const countParams: string[] = [];

  if (opts.language) {
    countSql += " WHERE language = ?";
    sql += " WHERE language = ?";
    params.push(opts.language);
    countParams.push(opts.language);
  }

  sql += " ORDER BY file_path, id LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const { total } = db.prepare(countSql).get(...countParams) as { total: number };
  const docs = db.prepare(sql).all(...params) as Pick<
    DocSection,
    "id" | "file_path" | "heading" | "language"
  >[];

  return { docs, total };
}
