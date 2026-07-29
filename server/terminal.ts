import type WebSocket from "ws";
import * as pty from "node-pty";
import { config } from "./config.js";

export type TerminalSession = {
  pty: pty.IPty;
  cwd: string;
};

export function spawnClaudeSession(cwd: string, cols: number, rows: number): TerminalSession {
  const shell = process.env.SHELL ?? "/bin/bash";
  const cmd = config.claudeCommand;

  const ptyProcess = config.useLoginShell
    ? pty.spawn(shell, ["-lc", `cd ${shellQuote(cwd)} && exec ${cmd}`], {
        name: "xterm-256color",
        cols: Math.max(cols, 10),
        rows: Math.max(rows, 3),
        cwd,
        env: process.env as Record<string, string>,
      })
    : pty.spawn(cmd, [], {
        name: "xterm-256color",
        cols: Math.max(cols, 10),
        rows: Math.max(rows, 3),
        cwd,
        env: process.env as Record<string, string>,
      });

  return { pty: ptyProcess, cwd };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function attachTerminal(ws: WebSocket, session: TerminalSession): () => void {
  const { pty: ptyProcess } = session;

  const onData = (data: string) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "output", data }));
    }
  };

  ptyProcess.onData(onData);

  const onMessage = (raw: WebSocket.RawData) => {
    let msg: { type: string; data?: string; cols?: number; rows?: number };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "input" && typeof msg.data === "string") {
      ptyProcess.write(msg.data);
    } else if (msg.type === "resize" && msg.cols && msg.rows) {
      ptyProcess.resize(msg.cols, msg.rows);
    }
  };

  ws.on("message", onMessage);

  const cleanup = () => {
    ws.off("message", onMessage);
    try {
      ptyProcess.kill();
    } catch {
      /* already dead */
    }
  };

  ws.on("close", cleanup);
  ptyProcess.onExit(() => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "exit" }));
      ws.close();
    }
  });

  return cleanup;
}
