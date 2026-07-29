import os from "node:os";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv();

function expandHome(p: string): string {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  if (p === "~") return os.homedir();
  return p;
}

export const config = {
  port: Number(process.env.PORT ?? 3847),
  host: process.env.HOST ?? "127.0.0.1",
  claudeCommand: process.env.CLAUDE_COMMAND ?? "claude",
  useLoginShell: (process.env.USE_LOGIN_SHELL ?? "true").toLowerCase() !== "false",
  workspaceRoots: (process.env.WORKSPACE_ROOTS ?? path.join(os.homedir(), "dev"))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(expandHome),
};
