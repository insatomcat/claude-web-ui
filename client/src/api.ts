export type FolderEntry = {
  name: string;
  path: string;
  isGit: boolean;
  branch: string | null;
};

export async function fetchRoots(): Promise<string[]> {
  const r = await fetch("/api/roots");
  if (!r.ok) throw new Error("roots");
  const j = (await r.json()) as { roots: string[] };
  return j.roots;
}

export async function fetchFolders(root: string): Promise<{
  root: string;
  folders: FolderEntry[];
}> {
  const r = await fetch(`/api/folders?root=${encodeURIComponent(root)}`);
  if (!r.ok) throw new Error("folders");
  return r.json() as Promise<{ root: string; folders: FolderEntry[] }>;
}

const RECENTS_KEY = "claudewebui-recents";
const MAX_RECENTS = 12;

export function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => typeof x === "string").slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function pushRecent(path: string): void {
  const prev = loadRecents().filter((p) => p !== path);
  const next = [path, ...prev].slice(0, MAX_RECENTS);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
}

export function basename(p: string): string {
  const parts = p.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || p;
}
