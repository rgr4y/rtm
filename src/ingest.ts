import { openDb, clearDocs, insertSection } from "./db";
import { loadConfig, getDbPath, getDocsDir, type SourceConfig } from "./config";
import type Database from "better-sqlite3";
import fs from "fs";
import path from "path";

interface TreeEntry {
  path: string;
  type: string;
  url: string;
}

async function fetchTree(repo: string, branch: string): Promise<TreeEntry[]> {
  const url = `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub tree API: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { tree: TreeEntry[] };
  return data.tree;
}

async function fetchRawFile(repo: string, branch: string, filePath: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${filePath}: ${res.status}`);
  return res.text();
}

function detectLanguage(filePath: string): string {
  const match = filePath.match(/^docs\/i18n\/([a-z]{2}(?:-[A-Z]{2})?)\//);
  if (match) return match[1];
  return "en";
}

interface Section {
  heading: string;
  content: string;
}

function splitByHeadings(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let currentHeading = "(intro)";
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      if (currentLines.length > 0) {
        const content = currentLines.join("\n").trim();
        if (content.length > 0) {
          sections.push({ heading: currentHeading, content });
        }
      }
      currentHeading = headingMatch[2];
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    const content = currentLines.join("\n").trim();
    if (content.length > 0) {
      sections.push({ heading: currentHeading, content });
    }
  }

  return sections;
}

async function ingestSource(
  db: Database.Database,
  source: SourceConfig,
  opts: { allLangs?: boolean; verbose?: boolean }
): Promise<{ filesProcessed: number; sectionsInserted: number }> {
  const log = opts.verbose ? console.log : () => {};
  const repo = source.repo;
  const branch = source.branch ?? "main";
  const docsPrefix = source.docsPrefix ?? "docs/";

  const config = loadConfig();
  const docsDir = getDocsDir(config, source.name);

  log(`[${source.name}] Fetching tree from ${repo}@${branch}...`);
  const tree = await fetchTree(repo, branch);

  const mdFiles = tree.filter((entry) => {
    if (entry.type !== "blob") return false;
    if (!entry.path.startsWith(docsPrefix)) return false;
    if (!entry.path.endsWith(".md")) return false;
    if (/\.(jpg|png|svg|gif)$/i.test(entry.path)) return false;
    if (!opts.allLangs) {
      const lang = detectLanguage(entry.path);
      if (lang !== "en") return false;
    }
    return true;
  });

  log(`[${source.name}] Found ${mdFiles.length} markdown files.`);

  // Save docs locally
  fs.rmSync(docsDir, { recursive: true, force: true });
  fs.mkdirSync(docsDir, { recursive: true });

  let filesProcessed = 0;
  let sectionsInserted = 0;
  const allSections: { file_path: string; heading: string; content: string; language: string }[] = [];

  const batchSize = 10;
  for (let i = 0; i < mdFiles.length; i += batchSize) {
    const batch = mdFiles.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (entry) => {
        const content = await fetchRawFile(repo, branch, entry.path);
        return { path: entry.path, content };
      })
    );

    for (const { path: filePath, content } of results) {
      // Strip docsPrefix so we don't get docs/docs/ nesting
      const relativePath = filePath.startsWith(docsPrefix)
        ? filePath.slice(docsPrefix.length)
        : filePath;

      // Write raw markdown to disk
      const localPath = path.join(docsDir, relativePath);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, content, "utf-8");

      const lang = detectLanguage(filePath);
      const sections = splitByHeadings(content);
      for (const section of sections) {
        allSections.push({
          file_path: `${source.name}/${relativePath}`,
          heading: section.heading,
          content: section.content,
          language: lang,
        });
      }
      filesProcessed++;
      log(`  [${filesProcessed}/${mdFiles.length}] ${filePath} (${sections.length} sections)`);
    }
  }

  const insertMany = db.transaction(
    (sections: { file_path: string; heading: string; content: string; language: string }[]) => {
      for (const s of sections) {
        insertSection(db, s);
      }
    }
  );
  insertMany(allSections);
  sectionsInserted = allSections.length;

  return { filesProcessed, sectionsInserted };
}

export async function ingest(opts: {
  dbPath?: string;
  source?: string;
  allLangs?: boolean;
  verbose?: boolean;
}): Promise<{ filesProcessed: number; sectionsInserted: number }> {
  const config = loadConfig();
  const dbPath = opts.dbPath ?? getDbPath(config);
  const db = openDb(dbPath);
  const log = opts.verbose ? console.log : () => {};

  // Filter to a single source if requested
  const sources = opts.source
    ? config.sources.filter((s) => s.name === opts.source)
    : config.sources;

  if (sources.length === 0) {
    const available = config.sources.map((s) => s.name).join(", ");
    throw new Error(`Source "${opts.source}" not found in config. Available: ${available}`);
  }

  clearDocs(db);

  let totalFiles = 0;
  let totalSections = 0;

  for (const source of sources) {
    const result = await ingestSource(db, source, opts);
    totalFiles += result.filesProcessed;
    totalSections += result.sectionsInserted;
  }

  db.close();
  log(`Done. ${totalFiles} files, ${totalSections} sections indexed from ${sources.length} source(s).`);
  return { filesProcessed: totalFiles, sectionsInserted: totalSections };
}
