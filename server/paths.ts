import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "./config.js";

export class PathNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathNotAllowedError";
  }
}

async function resolvedReal(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    throw new PathNotAllowedError("Chemin introuvable");
  }
}

export async function assertPathUnderRoots(requested: string): Promise<string> {
  const expanded = requested.startsWith("~")
    ? path.join(os.homedir(), requested.replace(/^~\/?/, ""))
    : requested;

  const absolute = path.resolve(expanded);
  const real = await resolvedReal(absolute);

  for (const root of config.workspaceRoots) {
    let rootReal: string;
    try {
      rootReal = await resolvedReal(root);
    } catch {
      continue;
    }
    if (real === rootReal || real.startsWith(rootReal + path.sep)) {
      return real;
    }
  }

  throw new PathNotAllowedError("Ce dossier n’est pas dans WORKSPACE_ROOTS");
}

export async function listSubfolders(rootPath: string): Promise<
  Array<{
    name: string;
    path: string;
    isGit: boolean;
    branch: string | null;
  }>
> {
  const safeRoot = await assertPathUnderRoots(rootPath);
  let entries: string[];
  try {
    entries = await fs.readdir(safeRoot);
  } catch {
    return [];
  }

  const results: Array<{
    name: string;
    path: string;
    isGit: boolean;
    branch: string | null;
  }> = [];

  for (const name of entries.sort((a, b) => a.localeCompare(b))) {
    if (name.startsWith(".")) continue;
    const full = path.join(safeRoot, name);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let isGit = false;
    let branch: string | null = null;
    try {
      await fs.access(path.join(full, ".git"));
      isGit = true;
      branch = await readGitBranch(full);
    } catch {
      /* not a git repo */
    }

    results.push({ name, path: full, isGit, branch });
  }

  return results;
}

async function readGitBranch(repoPath: string): Promise<string | null> {
  try {
    const head = await fs.readFile(path.join(repoPath, ".git", "HEAD"), "utf8");
    const trimmed = head.trim();
    if (trimmed.startsWith("ref: refs/heads/")) {
      return trimmed.slice("ref: refs/heads/".length);
    }
    return trimmed.slice(0, 7);
  } catch {
    return null;
  }
}

export async function folderMeta(folderPath: string): Promise<{
  path: string;
  name: string;
  isGit: boolean;
  branch: string | null;
  mtime: string | null;
}> {
  const safe = await assertPathUnderRoots(folderPath);
  const name = path.basename(safe);
  let isGit = false;
  let branch: string | null = null;
  try {
    await fs.access(path.join(safe, ".git"));
    isGit = true;
    branch = await readGitBranch(safe);
  } catch {
    /* */
  }
  let mtime: string | null = null;
  try {
    const st = await fs.stat(safe);
    mtime = st.mtime.toISOString();
  } catch {
    /* */
  }
  return { path: safe, name, isGit, branch, mtime };
}
