import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import {
  PathNotAllowedError,
  assertPathUnderRoots,
  folderMeta,
  listSubfolders,
} from "./paths.js";
import { attachTerminal, spawnClaudeSession } from "./terminal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, "../../client/dist");

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/roots", (_req, res) => {
  res.json({ roots: config.workspaceRoots });
});

app.get("/api/folders", async (req, res) => {
  try {
    const root = typeof req.query.root === "string" ? req.query.root : config.workspaceRoots[0];
    if (!root) {
      res.status(400).json({ error: "Aucune racine configurée (WORKSPACE_ROOTS)" });
      return;
    }
    const safe = await assertPathUnderRoots(root);
    const folders = await listSubfolders(safe);
    res.json({ root: safe, folders });
  } catch (e) {
    if (e instanceof PathNotAllowedError) {
      res.status(403).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: "Impossible de lister le dossier" });
  }
});

app.get("/api/folder", async (req, res) => {
  try {
    const p = req.query.path;
    if (typeof p !== "string") {
      res.status(400).json({ error: "path requis" });
      return;
    }
    const meta = await folderMeta(p);
    res.json(meta);
  } catch (e) {
    if (e instanceof PathNotAllowedError) {
      res.status(403).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: "Erreur métadonnées" });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname !== "/ws/terminal") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    void handleTerminalWs(ws, url);
  });
});

async function handleTerminalWs(
  ws: import("ws").WebSocket,
  url: URL,
): Promise<void> {
  const cwdParam = url.searchParams.get("cwd");
  const cols = Number(url.searchParams.get("cols") ?? 80);
  const rows = Number(url.searchParams.get("rows") ?? 24);

  if (!cwdParam) {
    ws.send(JSON.stringify({ type: "error", message: "cwd manquant" }));
    ws.close();
    return;
  }

  let cwd: string;
  try {
    cwd = await assertPathUnderRoots(cwdParam);
  } catch (e) {
    const message = e instanceof PathNotAllowedError ? e.message : "Chemin refusé";
    ws.send(JSON.stringify({ type: "error", message }));
    ws.close();
    return;
  }

  let session;
  try {
    session = spawnClaudeSession(cwd, cols, rows);
  } catch (e) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: e instanceof Error ? e.message : "Échec du lancement PTY",
      }),
    );
    ws.close();
    return;
  }

  ws.send(JSON.stringify({ type: "ready", cwd, command: config.claudeCommand }));
  attachTerminal(ws, session);
}

const hasClient = fs.existsSync(path.join(clientDist, "index.html"));
if (hasClient) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

server.listen(config.port, config.host, () => {
  console.log(`claudewebui http://${config.host}:${config.port}`);
});
