# Claude Web UI

Interface web responsive pour lancer **Claude Code** (`claude`) sur une machine distante (VPS), depuis un navigateur ou un iPhone.

L’exposition réseau et l’authentification sont **à ta charge** (nginx, Tailscale, etc.). L’app écoute par défaut sur `127.0.0.1`.

## Fonctionnalités (MVP)

- Sélecteur de dossiers sous `WORKSPACE_ROOTS` (repos git avec branche)
- Récents (localStorage navigateur)
- Session terminal complète (PTY + vrai CLI `claude`)
- Composer avec **dictée vocale** (Safari / Chrome)
- Barre de touches mobile (Tab, Ctrl+C, flèches…)
- UI sombre, safe areas iPhone

## Prérequis

- Node.js 20+
- `claude` disponible dans le `PATH` de l’utilisateur qui lance le serveur
- Linux recommandé sur la VPS (`node-pty`)

## Installation

```bash
cp .env.example .env
# Éditer WORKSPACE_ROOTS, CLAUDE_COMMAND si besoin

npm install
npm run build
npm start
```

Développement local (client Vite + serveur avec rechargement) :

```bash
npm run dev
```

UI sur http://127.0.0.1:5173 (proxy API/WS vers le serveur).

## Configuration

| Variable | Défaut | Description |
|----------|--------|-------------|
| `HOST` | `127.0.0.1` | Interface d’écoute |
| `PORT` | `3847` | Port HTTP + WebSocket |
| `WORKSPACE_ROOTS` | `~/dev` | Racines listées (chemins absolus, séparés par `,`) |
| `CLAUDE_COMMAND` | `claude` | Commande exécutée à l’ouverture d’une session |
| `USE_LOGIN_SHELL` | `true` | Passe par `bash -lc` (charge `.profile`, nvm, etc.) |

Seuls les chemins **sous** `WORKSPACE_ROOTS` sont autorisés (anti path traversal).

## nginx (exemple)

Tu gères auth + TLS ; l’app reste en local :

```nginx
location / {
    proxy_pass http://127.0.0.1:3847;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400;
}
```

WebSocket : même `location` avec les en-têtes `Upgrade` ci-dessus.

## systemd (exemple)

```ini
[Unit]
Description=Claude Web UI
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/claudewebui
EnvironmentFile=/opt/claudewebui/.env
ExecStart=/usr/bin/node dist/server/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## Notes iPhone

- Ajouter à l’écran d’accueil pour une expérience quasi-app.
- La dictée nécessite **HTTPS** (ou localhost). Configure TLS devant nginx.
- Le micro Safari peut demander une autorisation par site.

## Licence

MIT (à toi de choisir si tu préfères autre chose).
# claude-web-ui
