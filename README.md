# Eve

Dashboard web pour gérer Apple Container sur macOS: containers, machines, images, registres, réseaux, volumes, builder, utilisateurs et commandes système.

## Authentification

Eve utilise une base utilisateurs locale (`users` dans SQLite), pas `EVE_UI_PASSWORD`.

Au premier démarrage sur une base vide (`EVE_DB_PATH`):

- Login: `eve`
- Mot de passe: `vap0r`
- Rôle: `owner`

Important:

- Ces identifiants par défaut ne sont créés qu'une seule fois.
- Si la DB existe déjà, les identifiants sont ceux stockés en base.
- Change le mot de passe immédiatement après le premier login.

## Prérequis

- macOS Apple Silicon avec Apple Container installé
- Go 1.22+
- Node.js 18+

Apple Container doit être installé depuis les releases officielles:

```bash
container system start
```

Si `container` n'est pas installé, Eve affiche les instructions d'installation. L'installation demande des droits administrateur macOS et n'est pas lancée silencieusement par Eve.

## Lancer en local (rapide)

```bash
# 1) Installer les deps frontend
npm install --prefix frontend

# 2) Builder le frontend (nécessaire pour l'embed Go)
npm run build --prefix frontend

# 3) Lancer l'app
go run .
```

Puis ouvrir `http://localhost:8100`.

Ou:

```bash
go run . --open
```

## Mode développement (backend hot reload + frontend Vite)

```bash
make dev
```

- API backend: `http://localhost:8100`
- UI Vite: `http://localhost:5173`

Le frontend Vite proxy `/api`, `/auth`, `/ws` vers `localhost:8100`.

## Build binaire

```bash
make build
./eve --open
```

## Build app macOS

```bash
make macos-app
open dist/Eve.app
```

## Installation systemd (prod)

```bash
./deploy/install.sh
```

Le script:

1. Build frontend + binaire Go
2. Installe `/usr/local/bin/eve`
3. Crée `/etc/eve/eve.env` si absent
4. Installe `eve@.service`
5. Active `eve@<user-courant>`

Commandes utiles:

```bash
systemctl status "eve@$(id -un)"
journalctl -u "eve@$(id -un)" -f
```

## Désinstallation

```bash
sudo ./deploy/uninstall.sh
```

Le script retire les unités systemd Eve, mais conserve:

- `/etc/eve/eve.env`
- `/var/lib/eve/`

## Configuration

Variables supportées (voir `internal/config/config.go`):

| Variable | Défaut |
|---|---|
| `EVE_BIND` | `0.0.0.0:8100` |
| `EVE_SESSION_TTL` | `24h` |
| `EVE_JWT_SECRET` | valeur interne par défaut (à changer en prod) |
| `EVE_CONTAINER_BINARY` | `container` |
| `EVE_CONTAINER_TIMEOUT` | `45s` |
| `EVE_CONTAINER_CONCURRENCY` | `6` |
| `EVE_INSTANCES_CACHE_TTL` | `2s` |
| `EVE_POLL_INTERVAL` | `5s` |
| `EVE_DB_PATH` | `eve.db` |
| `EVE_ACTIVITY_RETENTION` | `5000` |
| `EVE_LOG_LEVEL` | `info` |
| `EVE_LOG_FORMAT` | `text` |
| `EVE_FRONTEND_DIR` | vide (frontend embarqué) |

Notes:

- `EVE_UI_USERNAME` / `EVE_UI_PASSWORD` sont des anciens réglages, non utilisés par l'auth actuelle.
- En production, définis `EVE_JWT_SECRET` explicitement.

## Documentation détaillée

Voir `documentation.md` pour:

- flux dev/prod complets
- troubleshooting
- checklist sécurité
- commandes d'exploitation
