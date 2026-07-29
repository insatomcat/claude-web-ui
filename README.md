# Claude Web UI

Interface web responsive pour lancer **Claude Code** (`claude`) sur une VPS, depuis un navigateur ou un iPhone.

Stack **Python (FastAPI + PTY)** et **JS vanilla** (xterm.js). Pas de Node en production.

L'exposition réseau et l'authentification restent **à ta charge** (nginx, Tailscale, etc.). L'app écoute par défaut sur `127.0.0.1`.

## Fonctionnalités (MVP)

- Sélecteur de dossiers sous `WORKSPACE_ROOTS` (repos git avec branche)
- Récents (localStorage navigateur)
- Session terminal complète (PTY + vrai CLI `claude`)
- Composer avec dictée vocale (Safari / Chrome)
- Barre de touches mobile (Tab, Ctrl+C, flèches…)
- UI sombre, safe areas iPhone

## Prérequis

- Python 3.11+
- Linux sur la VPS (module `pty` stdlib)
- `claude` dans le `PATH` de l'utilisateur qui lance le service

## Installation

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# WORKSPACE_ROOTS=/home/toi/dev,...

uvicorn app.main:app --host 127.0.0.1 --port 3847
```

Variables lues depuis `.env` (via `python-dotenv` au démarrage).

## Configuration

| Variable | Défaut | Description |
|----------|--------|-------------|
| `HOST` | `127.0.0.1` | Interface d'écoute (uvicorn `--host`) |
| `PORT` | `3847` | Port (uvicorn `--port`) |
| `WORKSPACE_ROOTS` | `~/dev` | Racines listées (chemins absolus, séparés par `,`) |
| `CLAUDE_COMMAND` | `claude` | Commande lancée à l'ouverture d'une session |
| `USE_LOGIN_SHELL` | `true` | Passe par `bash -lc` (`.profile`, nvm, etc.) |

Seuls les chemins **sous** `WORKSPACE_ROOTS` sont autorisés.

## nginx (exemple)

```nginx
# Exemple sous-chemin https://host/claude/ (URLs relatives côté navigateur)
location /claude/ {
    proxy_pass http://127.0.0.1:3847/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400;
}
```

Ou à la racine du vhost :

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
ExecStart=/opt/claudewebui/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 3847
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## Notes iPhone

- Ajouter à l'écran d'accueil pour une expérience quasi-app.
- Dictée : **HTTPS** devant nginx.
- xterm.js est chargé via CDN (esm.sh / jsDelivr) ; la VPS doit pouvoir servir `/static` localement.
