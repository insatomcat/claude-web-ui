import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "xterm/css/xterm.css";

export type TerminalHandle = {
  send: (data: string) => void;
  sendLine: (line: string) => void;
  focus: () => void;
};

type Props = {
  cwd: string;
  onExit: () => void;
  onReady: (handle: TerminalHandle) => void;
};

export function TerminalView({ cwd, onExit, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onReadyRef = useRef(onReady);
  const onExitRef = useRef(onExit);
  const [status, setStatus] = useState<"connecting" | "ready" | "error" | "closed">(
    "connecting",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  onReadyRef.current = onReady;
  onExitRef.current = onExit;

  useEffect(() => {
    if (!containerRef.current) return;

    setStatus("connecting");
    setErrorMsg(null);

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
      theme: {
        background: "#0f1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
        selectionBackground: "#264f78",
      },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;

    const cols = term.cols;
    const rows = term.rows;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${window.location.host}/ws/terminal?cwd=${encodeURIComponent(cwd)}&cols=${cols}&rows=${rows}`,
    );
    wsRef.current = ws;

    const send = (data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    };
    const sendLine = (line: string) => send(line.endsWith("\n") ? line : `${line}\r`);
    const handle: TerminalHandle = {
      send,
      sendLine,
      focus: () => term.focus(),
    };

    term.onData((data) => send(data));

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          type: string;
          data?: string;
          message?: string;
        };
        if (msg.type === "output" && msg.data) term.write(msg.data);
        if (msg.type === "ready") {
          setStatus("ready");
          onReadyRef.current(handle);
        }
        if (msg.type === "error") {
          setStatus("error");
          setErrorMsg(msg.message ?? "Erreur");
        }
        if (msg.type === "exit") {
          setStatus("closed");
          onExitRef.current();
        }
      } catch {
        /* ignore */
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setErrorMsg("Connexion WebSocket impossible");
    };

    const onResize = () => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
        );
      }
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(containerRef.current);

    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
    };
  }, [cwd]);

  return (
    <div className="terminal-wrap">
      {status === "connecting" && (
        <div className="terminal-overlay">Connexion à Claude…</div>
      )}
      {status === "error" && (
        <div className="terminal-overlay error">{errorMsg}</div>
      )}
      <div ref={containerRef} className="terminal-host" />
    </div>
  );
}
