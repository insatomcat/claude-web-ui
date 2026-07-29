import { useCallback, useEffect, useMemo, useState } from "react";
import {
  basename,
  fetchFolders,
  fetchRoots,
  loadRecents,
  pushRecent,
  type FolderEntry,
} from "./api";
import { MobileKeys } from "./MobileKeys";
import { TerminalView } from "./TerminalView";
import { useTerminalBridge, VoiceComposer } from "./VoiceComposer";

type Screen = "pick" | "session";

export function App() {
  const [screen, setScreen] = useState<Screen>("pick");
  const [roots, setRoots] = useState<string[]>([]);
  const [currentRoot, setCurrentRoot] = useState<string>("");
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sessionCwd, setSessionCwd] = useState<string | null>(null);
  const [recents, setRecents] = useState<string[]>(() => loadRecents());
  const [showKeys, setShowKeys] = useState(true);
  const { setHandle, sendToTerminal } = useTerminalBridge();
  const [termReady, setTermReady] = useState(false);

  const loadRoot = useCallback(async (root: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFolders(root);
      setCurrentRoot(data.root);
      setFolders(data.folders);
    } catch {
      setError("Impossible de charger les dossiers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetchRoots();
        setRoots(r);
        if (r[0]) await loadRoot(r[0]);
        else setLoading(false);
      } catch {
        setError("Serveur injoignable");
        setLoading(false);
      }
    })();
  }, [loadRoot]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.branch?.toLowerCase().includes(q) ?? false),
    );
  }, [folders, filter]);

  const openSession = (path: string) => {
    pushRecent(path);
    setRecents(loadRecents());
    setSessionCwd(path);
    setTermReady(false);
    setScreen("session");
  };

  const onTerminalReady = useCallback(
    (h: Parameters<typeof setHandle>[0]) => {
      setHandle(h);
      setTermReady(true);
    },
    [setHandle],
  );

  if (screen === "session" && sessionCwd) {
    return (
      <div className="app session">
        <header className="topbar">
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setScreen("pick");
              setSessionCwd(null);
            }}
          >
            ← Projets
          </button>
          <div className="topbar-title" title={sessionCwd}>
            {basename(sessionCwd)}
          </div>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setShowKeys((v) => !v)}
            aria-pressed={showKeys}
          >
            Clavier
          </button>
        </header>
        <TerminalView
          cwd={sessionCwd}
          onExit={() => setTermReady(false)}
          onReady={onTerminalReady}
        />
        <VoiceComposer onSend={sendToTerminal} disabled={!termReady} />
        {showKeys && (
          <MobileKeys
            onKey={(seq) => sendToTerminal(seq, { appendNewline: false })}
            onFocusTerminal={() => {}}
          />
        )}
      </div>
    );
  }

  return (
    <div className="app pick">
      <header className="hero">
        <h1>Claude Web UI</h1>
        <p>Choisis un dossier. Une session Claude s’ouvre dans ce répertoire.</p>
      </header>

      {recents.length > 0 && (
        <section className="section">
          <h2>Récents</h2>
          <div className="chip-row">
            {recents.map((p) => (
              <button
                key={p}
                type="button"
                className="chip recent"
                onClick={() => openSession(p)}
                title={p}
              >
                {basename(p)}
              </button>
            ))}
          </div>
        </section>
      )}

      {roots.length > 1 && (
        <section className="section">
          <h2>Racine</h2>
          <div className="chip-row">
            {roots.map((r) => (
              <button
                key={r}
                type="button"
                className={`chip ${r === currentRoot ? "active" : ""}`}
                onClick={() => void loadRoot(r)}
                title={r}
              >
                {basename(r) || r}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="section grow">
        <div className="section-head">
          <h2>Dossiers</h2>
          <input
            className="search"
            type="search"
            placeholder="Filtrer…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            enterKeyHint="search"
          />
        </div>
        {loading && <p className="muted">Chargement…</p>}
        {error && <p className="error-text">{error}</p>}
        {!loading && !error && (
          <ul className="folder-list">
            {filtered.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  className="folder-row"
                  onClick={() => openSession(f.path)}
                >
                  <span className="folder-name">{f.name}</span>
                  {f.isGit && (
                    <span className="folder-meta">
                      {f.branch ? `⎇ ${f.branch}` : "git"}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="muted">Aucun sous-dossier ici.</li>
            )}
          </ul>
        )}
        {currentRoot && (
          <button
            type="button"
            className="btn primary block open-root"
            onClick={() => openSession(currentRoot)}
          >
            Ouvrir la racine « {basename(currentRoot) || currentRoot} »
          </button>
        )}
      </section>
    </div>
  );
}
