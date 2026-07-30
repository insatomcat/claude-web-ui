# Claude Web UI

Interface web responsive pour lancer **Claude Code** (`claude`) sur une VPS, depuis un navigateur ou un iPhone.

Stack **Python (FastAPI + PTY)** et **JS vanilla** (xterm.js). Pas de Node en production.

L'exposition réseau et l'authentification restent **à ta charge** (nginx, Tailscale, etc.). L'app écoute par défaut sur `127.0.0.1`.

## Fonctionnalités (MVP)

- Sélecteur de dossiers sous `WORKSPACE_ROOTS` (repos git avec branche)
- Récents (localStorage navigateur)
- Session terminal complète (PTY + vrai CLI `claude`)
- Composer optionnel (masqué sur mobile ; bouton **Prompt**)
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
| `ROOT_PATH` | *(vide)* | Préfixe public (`/claude`) pour API/WS côté navigateur |
| `MOUNT_AT_ROOT_PATH` | `false` | Monter l'app FastAPI sous `ROOT_PATH` (si nginx ne retire pas le préfixe) |

Seuls les chemins **sous** `WORKSPACE_ROOTS` sont autorisés.

## nginx (exemple)

Préfère retirer le préfixe côté upstream (`/` final sur `proxy_pass`) et définir `ROOT_PATH=/claude` dans `.env` :

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

location /claude/ {
    proxy_pass http://127.0.0.1:3847/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Prefix /claude;
    proxy_read_timeout 86400;
}
```

`X-Forwarded-Prefix` et `ROOT_PATH` permettent au front de cibler `wss://host/claude/ws/terminal` même quand uvicorn ne voit que `/ws/terminal`.

### Authentification nginx (éviter la double demande iPhone)

Safari redemande souvent login/mot de passe à l'ouverture du **WebSocket** si `auth_basic` n'est pas configuré pour le relayer :

```nginx
location /claude/ {
    auth_basic "Claude Web UI";
    auth_basic_user_file /etc/nginx/.htpasswd;

    proxy_pass http://127.0.0.1:3847/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header X-Forwarded-Prefix /claude;
    proxy_read_timeout 86400;
}
```

Même `auth_basic`, même `location` pour HTML, API et WS. Pas de bloc séparé sans auth pour `/ws/`.

Si Safari redemande quand même : préférer une auth par **cookie** (Authelia, oauth2-proxy) ou Tailscale sans `auth_basic` devant l'app.

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
