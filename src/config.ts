import fs from "fs";
import os from "os";
import path from "path";

function isGlobalInstall(): boolean {
  return __dirname.startsWith("/usr/local");
}

// Data always lives in user's home — it's user data, not system data
const DATA_DIR = path.join(os.homedir(), ".local", "rtm");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

export interface SourceConfig {
  name: string;
  repo: string;
  branch?: string;
  docsPrefix?: string;
}

export interface Config {
  sources: SourceConfig[];
  dataDir: string;
  lastSource?: string;
}

const DEFAULT_CONFIG: Config = {
  sources: [
    {
      name: "zeroclaw",
      repo: "zeroclaw-labs/zeroclaw",
      branch: "main",
      docsPrefix: "docs/",
    },
  ],
  dataDir: DATA_DIR,
  lastSource: "zeroclaw",
};

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function isGlobal(): boolean {
  return isGlobalInstall();
}

function hasWriteAccess(dir: string): boolean {
  // Walk up to find the first existing ancestor and check write permission
  let check = dir;
  while (!fs.existsSync(check)) {
    const parent = path.dirname(check);
    if (parent === check) return false;
    check = parent;
  }
  try {
    fs.accessSync(check, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function checkWriteAccess(): void {
  if (!hasWriteAccess(DATA_DIR)) {
    console.error(`Error: No write permission to ${DATA_DIR}\nCheck directory permissions.`);
    process.exit(1);
  }
}

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    // Return defaults in memory; only write if we have access
    if (hasWriteAccess(DATA_DIR) || hasWriteAccess(path.dirname(DATA_DIR))) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf-8");
    }
    return DEFAULT_CONFIG;
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  return {
    sources: raw.sources ?? DEFAULT_CONFIG.sources,
    dataDir: raw.dataDir ?? DATA_DIR,
    lastSource: raw.lastSource,
  };
}

export function getDbPath(config: Config): string {
  return path.join(config.dataDir, "rtm.db");
}

export function getDocsDir(config: Config, sourceName: string): string {
  return path.join(config.dataDir, sourceName);
}

function saveConfig(config: Config): void {
  checkWriteAccess();
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function addSource(source: SourceConfig): void {
  const config = loadConfig();
  const existing = config.sources.findIndex((s) => s.name === source.name);
  if (existing >= 0) {
    config.sources[existing] = source;
  } else {
    config.sources.push(source);
  }
  config.lastSource = source.name;
  saveConfig(config);
}

export function removeSource(name: string): boolean {
  const config = loadConfig();
  const before = config.sources.length;
  config.sources = config.sources.filter((s) => s.name !== name);
  if (config.sources.length === before) return false;
  // If we removed the last-used source, reset to the final remaining one
  if (config.lastSource === name) {
    config.lastSource = config.sources.length > 0
      ? config.sources[config.sources.length - 1].name
      : undefined;
  }
  saveConfig(config);
  return true;
}

export function setLastSource(name: string): void {
  const config = loadConfig();
  config.lastSource = name;
  saveConfig(config);
}

export function getDefaultSource(config: Config): string | undefined {
  // Last-used source, or the last one in the list, or undefined
  if (config.lastSource && config.sources.some((s) => s.name === config.lastSource)) {
    return config.lastSource;
  }
  if (config.sources.length > 0) {
    return config.sources[config.sources.length - 1].name;
  }
  return undefined;
}
