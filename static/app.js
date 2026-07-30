import { Terminal } from "https://esm.sh/@xterm/xterm@5.5.0";
import { FitAddon } from "https://esm.sh/@xterm/addon-fit@0.10.0";

const RECENTS_KEY = "claudewebui-recents";
const MAX_RECENTS = 12;

const MOBILE_KEYS = [
  { label: "Tab", seq: "\t" },
  { label: "Esc", seq: "\x1b" },
  { label: "Ctrl+C", seq: "\x03" },
  { label: "Ctrl+D", seq: "\x04" },
  { label: "PgUp", seq: "\x1b[5~" },
  { label: "PgDn", seq: "\x1b[6~" },
  { label: "↑", seq: "\x1b[A" },
  { label: "↓", seq: "\x1b[B" },
  { label: "←", seq: "\x1b[D" },
  { label: "→", seq: "\x1b[C" },
];

/** @type {HTMLElement} */
const mount = document.getElementById("app");

/** @type {{ send: (d: string) => void, sendLine: (l: string) => void, focus: () => void } | null} */
let termHandle = null;

function basename(p) {
  const parts = p.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || p;
}

function loadRecents() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => typeof x === "string").slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function pushRecent(path) {
  const next = [path, ...loadRecents().filter((p) => p !== path)].slice(0, MAX_RECENTS);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
}

/** @type {string} Public mount path without trailing slash, e.g. "/claude" or "". */
let appBasePath = "";

function guessBaseFromLocation() {
  let p = location.pathname;
  if (!p || p === "/") return "";
  if (!p.endsWith("/")) return p;
  return p.replace(/\/$/, "") || "";
}

function readInitialBasePath() {
  const meta = document.getElementById("meta-app-base");
  const fromMeta = meta?.getAttribute("content")?.trim();
  if (fromMeta) return fromMeta.replace(/\/$/, "");
  return guessBaseFromLocation();
}

function applyBaseHref(basePath) {
  const href = basePath ? `${basePath.replace(/\/$/, "")}/` : "/";
  const base = document.getElementById("app-base");
  if (base) base.setAttribute("href", href);
}

function mountOrigin(basePath) {
  if (!basePath) return `${location.origin}/`;
  const segment = basePath.startsWith("/") ? basePath : `/${basePath}`;
  return `${location.origin}${segment.endsWith("/") ? segment : `${segment}/`}`;
}

/** Resolve path relative to the app mount (reverse proxy subpath). */
function appUrl(path) {
  return new URL(String(path).replace(/^\//, ""), mountOrigin(appBasePath));
}

function wsTerminalUrl(query) {
  const u = appUrl("ws/terminal");
  u.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  Object.entries(query).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  return u.toString();
}

async function loadAppConfig() {
  appBasePath = readInitialBasePath();
  applyBaseHref(appBasePath);
  try {
    const r = await fetch(appUrl("api/config"));
    if (!r.ok) return;
    const j = await r.json();
    if (typeof j.basePath === "string") {
      appBasePath = j.basePath.replace(/\/$/, "");
      applyBaseHref(appBasePath);
    }
  } catch {
    /* keep guessed base */
  }
}

async function fetchRoots() {
  const r = await fetch(appUrl("api/roots"));
  if (!r.ok) throw new Error("roots");
  const j = await r.json();
  return j.roots;
}

async function fetchFolders(root) {
  const u = appUrl("api/folders");
  u.searchParams.set("root", root);
  const r = await fetch(u);
  if (!r.ok) throw new Error("folders");
  return r.json();
}

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

function getSpeechRecognition() {
  const w = window;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function sendToTerminal(text, appendNewline) {
  if (!termHandle) return;
  if (appendNewline) termHandle.sendLine(text);
  else termHandle.send(text);
  termHandle.focus();
}

function attachTouchScroll(host, terminal) {
  let lastY = null;
  host.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 1) lastY = e.touches[0].clientY;
    },
    { passive: true },
  );
  host.addEventListener(
    "touchmove",
    (e) => {
      if (lastY == null || e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      const delta = y - lastY;
      lastY = y;
      if (Math.abs(delta) < 3) return;
      const lines = Math.max(1, Math.round(Math.abs(delta) / 10));
      terminal.scrollLines(delta > 0 ? -lines : lines);
    },
    { passive: true },
  );
  host.addEventListener(
    "touchend",
    () => {
      lastY = null;
    },
    { passive: true },
  );
}

function buildScrollBar() {
  const bar = el("div", "term-scroll");
  const buttons = [
    { label: "▲", title: "Historique terminal" },
    { label: "▼", title: "Vers le bas" },
    { label: "⤒", title: "Début buffer" },
    { label: "⤓", title: "Fin buffer" },
    { label: "Pg↑", title: "Page up (Claude)" },
    { label: "Pg↓", title: "Page down (Claude)" },
  ];
  for (const { label, title } of buttons) {
    const b = el("button", "key-chip scroll-chip");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.onmousedown = (e) => e.preventDefault();
    b.ontouchstart = (e) => e.preventDefault();
    bar.appendChild(b);
  }
  return bar;
}

function renderPick(state) {
  mount.innerHTML = "";
  const root = el("div", "app pick");

  const hero = el("header", "hero");
  hero.innerHTML = "<h1>Claude Web UI</h1><p>Choisis un dossier. Une session Claude s'ouvre dans ce répertoire.</p>";
  root.appendChild(hero);

  if (state.recents.length) {
    const sec = el("section", "section");
    sec.innerHTML = "<h2>Récents</h2>";
    const row = el("div", "chip-row");
    for (const p of state.recents) {
      const b = el("button", "chip recent");
      b.type = "button";
      b.title = p;
      b.textContent = basename(p);
      b.onclick = () => openSession(p, state);
      row.appendChild(b);
    }
    sec.appendChild(row);
    root.appendChild(sec);
  }

  if (state.roots.length > 1) {
    const sec = el("section", "section");
    sec.innerHTML = "<h2>Racine</h2>";
    const row = el("div", "chip-row");
    for (const r of state.roots) {
      const b = el("button", `chip${r === state.currentRoot ? " active" : ""}`);
      b.type = "button";
      b.title = r;
      b.textContent = basename(r) || r;
      b.onclick = () => loadRoot(r, state);
      row.appendChild(b);
    }
    sec.appendChild(row);
    root.appendChild(sec);
  }

  const sec = el("section", "section grow");
  const head = el("div", "section-head");
  head.innerHTML = "<h2>Dossiers</h2>";
  const search = el("input", "search");
  search.type = "search";
  search.placeholder = "Filtrer…";
  search.value = state.filter;
  search.enterKeyHint = "search";
  search.oninput = () => {
    state.filter = search.value;
    renderPick(state);
  };
  head.appendChild(search);
  sec.appendChild(head);

  if (state.loading) sec.appendChild(el("p", "muted", "Chargement…"));
  else if (state.error) sec.appendChild(el("p", "error-text", state.error));
  else {
    const q = state.filter.trim().toLowerCase();
    const filtered = state.folders.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.branch && f.branch.toLowerCase().includes(q)),
    );
    const ul = el("ul", "folder-list");
    if (!filtered.length) ul.appendChild(el("li", "muted", "Aucun sous-dossier ici."));
    for (const f of filtered) {
      const li = document.createElement("li");
      const btn = el("button", "folder-row");
      btn.type = "button";
      btn.innerHTML = `<span class="folder-name"></span><span class="folder-meta"></span>`;
      btn.querySelector(".folder-name").textContent = f.name;
      const meta = btn.querySelector(".folder-meta");
      if (f.isGit) meta.textContent = f.branch ? `⎇ ${f.branch}` : "git";
      btn.onclick = () => openSession(f.path, state);
      li.appendChild(btn);
      ul.appendChild(li);
    }
    sec.appendChild(ul);
  }

  if (state.currentRoot) {
    const openRoot = el("button", "btn primary block open-root");
    openRoot.type = "button";
    openRoot.textContent = `Ouvrir la racine « ${basename(state.currentRoot) || state.currentRoot} »`;
    openRoot.onclick = () => openSession(state.currentRoot, state);
    sec.appendChild(openRoot);
  }

  root.appendChild(sec);
  mount.appendChild(root);
}

async function loadRoot(root, state) {
  state.loading = true;
  state.error = null;
  renderPick(state);
  try {
    const data = await fetchFolders(root);
    state.currentRoot = data.root;
    state.folders = data.folders;
  } catch {
    state.error = "Impossible de charger les dossiers";
  }
  state.loading = false;
  renderPick(state);
}

function openSession(path, state) {
  pushRecent(path);
  state.recents = loadRecents();
  renderSession(path);
}

function renderSession(cwd) {
  termHandle = null;
  mount.innerHTML = "";
  const root = el("div", "app session");
  let termReady = false;
  let showKeys = true;
  /** @type {SpeechRecognition | null} */
  let recognition = null;
  let listening = false;

  const topbar = el("header", "topbar");
  const back = el("button", "btn ghost");
  back.type = "button";
  back.textContent = "← Projets";
  back.onclick = () => initPick();

  const title = el("div", "topbar-title");
  title.title = cwd;
  title.textContent = basename(cwd);

  const toggleKeys = el("button", "btn ghost");
  toggleKeys.type = "button";
  toggleKeys.textContent = "Clavier";

  topbar.append(back, title, toggleKeys);
  root.appendChild(topbar);

  const termWrap = el("div", "terminal-wrap");
  const overlay = el("div", "terminal-overlay");
  overlay.textContent = "Connexion à Claude…";
  const termHost = el("div", "terminal-host");
  termWrap.append(overlay, termHost);
  root.appendChild(termWrap);

  const scrollBar = buildScrollBar();
  root.appendChild(scrollBar);

  const composer = el("div", "composer");
  const textarea = el("textarea", "composer-input");
  textarea.rows = 2;
  textarea.placeholder = "Prompt (ou dictée micro)…";
  textarea.disabled = true;

  const actions = el("div", "composer-actions");
  const Speech = getSpeechRecognition();
  let micBtn = null;
  if (Speech) {
    micBtn = el("button", "btn icon");
    micBtn.type = "button";
    micBtn.title = "Dictée vocale";
    micBtn.textContent = "🎤";
    micBtn.onclick = () => {
      if (listening) {
        recognition?.stop();
        return;
      }
      recognition = new Speech();
      recognition.lang = navigator.language || "fr-FR";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (ev) => {
        let chunk = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          chunk += ev.results[i][0].transcript;
        }
        if (chunk) {
          textarea.value = textarea.value ? `${textarea.value} ${chunk}` : chunk;
        }
      };
      recognition.onend = () => {
        listening = false;
        micBtn.classList.remove("active");
        micBtn.textContent = "🎤";
      };
      recognition.start();
      listening = true;
      micBtn.classList.add("active");
      micBtn.textContent = "⏹";
    };
  }

  const sendBtn = el("button", "btn primary");
  sendBtn.type = "button";
  sendBtn.textContent = "Envoyer ↵";
  sendBtn.disabled = true;

  const pasteBtn = el("button", "btn");
  pasteBtn.type = "button";
  pasteBtn.textContent = "Coller";
  pasteBtn.disabled = true;

  const setComposerEnabled = (on) => {
    textarea.disabled = !on;
    sendBtn.disabled = !on || !textarea.value.trim();
    pasteBtn.disabled = !on || !textarea.value.trim();
  };

  textarea.oninput = () => {
    sendBtn.disabled = !termReady || !textarea.value.trim();
    pasteBtn.disabled = !termReady || !textarea.value.trim();
  };

  sendBtn.onclick = () => {
    sendToTerminal(textarea.value.trim(), true);
    textarea.value = "";
    recognition?.stop();
    setComposerEnabled(termReady);
  };

  pasteBtn.onclick = () => {
    sendToTerminal(textarea.value.trim(), false);
    setComposerEnabled(termReady);
  };

  if (micBtn) actions.appendChild(micBtn);
  actions.append(sendBtn, pasteBtn);
  composer.append(textarea, actions);
  root.appendChild(composer);

  const keysBar = el("div", "mobile-keys");
  for (const k of MOBILE_KEYS) {
    const b = el("button", "key-chip");
    b.type = "button";
    b.textContent = k.label;
    b.onmousedown = (e) => e.preventDefault();
    b.ontouchstart = (e) => e.preventDefault();
    b.onclick = () => sendToTerminal(k.seq, false);
    keysBar.appendChild(b);
  }
  root.appendChild(keysBar);

  toggleKeys.onclick = () => {
    showKeys = !showKeys;
    keysBar.classList.toggle("hidden", !showKeys);
    toggleKeys.setAttribute("aria-pressed", String(showKeys));
  };

  mount.appendChild(root);

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
    scrollback: 10000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(termHost);
  fit.fit();
  attachTouchScroll(termHost, term);

  const viewport = termHost.querySelector(".xterm-viewport");
  if (viewport) {
    viewport.style.touchAction = "pan-y";
    viewport.style.overflowY = "scroll";
  }

  const ws = new WebSocket(
    wsTerminalUrl({
      cwd,
      cols: term.cols,
      rows: term.rows,
    }),
  );

  const send = (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data }));
    }
  };

  scrollBar.querySelectorAll("button").forEach((btn, i) => {
    const actions = [
      () => term.scrollLines(-5),
      () => term.scrollLines(5),
      () => term.scrollToTop(),
      () => term.scrollToBottom(),
      () => send("\x1b[5~"),
      () => send("\x1b[6~"),
    ];
    btn.onclick = () => actions[i]?.();
  });

  termHandle = {
    send,
    sendLine: (line) => send(line.endsWith("\n") ? line : `${line}\r`),
    focus: () => term.focus(),
  };
  term.onData(send);

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "output") term.write(msg.data);
    if (msg.type === "ready") {
      overlay.classList.add("hidden");
      termReady = true;
      setComposerEnabled(true);
    }
    if (msg.type === "error") {
      overlay.classList.remove("hidden");
      overlay.classList.add("error");
      overlay.textContent = msg.message || "Erreur";
    }
    if (msg.type === "exit") {
      termReady = false;
      setComposerEnabled(false);
    }
  };

  ws.onerror = () => {
    overlay.classList.remove("hidden");
    overlay.classList.add("error");
    overlay.textContent = "Connexion WebSocket impossible";
  };

  const onResize = () => {
    fit.fit();
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    }
  };
  window.addEventListener("resize", onResize);
  const ro = new ResizeObserver(onResize);
  ro.observe(termHost);
}

async function initPick() {
  termHandle = null;
  /** @type {{ roots: string[], currentRoot: string, folders: any[], loading: boolean, error: string | null, filter: string, recents: string[] }} */
  const state = {
    roots: [],
    currentRoot: "",
    folders: [],
    loading: true,
    error: null,
    filter: "",
    recents: loadRecents(),
  };
  renderPick(state);
  try {
    state.roots = await fetchRoots();
    if (state.roots[0]) await loadRoot(state.roots[0], state);
    else state.loading = false;
  } catch {
    state.error = "Serveur injoignable";
    state.loading = false;
  }
  renderPick(state);
}

async function whenStylesReady() {
  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
  await Promise.all(
    links.map(
      (link) =>
        new Promise((resolve) => {
          if (link.sheet) {
            resolve();
            return;
          }
          link.addEventListener("load", resolve, { once: true });
          link.addEventListener("error", resolve, { once: true });
        }),
    ),
  );
}

async function boot() {
  if (document.readyState === "loading") {
    await new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
  }
  await whenStylesReady();
  await loadAppConfig();
  document.documentElement.classList.add("app-ready");
  await initPick();
}

boot();
