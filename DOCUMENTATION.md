# Eve Documentation

## 1. Architecture

Eve = backend Go + frontend React.

- Backend: HTTP API + WebSocket
- Frontend: bundle Vite (embarqué dans le binaire en prod)
- Hyperviseur: Multipass CLI
- Stockage: SQLite (`EVE_DB_PATH`)

## 2. Auth et comptes

Le backend initialise un compte owner par défaut uniquement si la table `users` est vide:

- login: `eve`
- password: `vap0r`

Ce bootstrap est déclenché au démarrage (`EnsureDefaultOwner(...)` dans `main.go`).

### Important

- Si la DB existe déjà, pas de reset automatique.
- Pour "retrouver" les identifiants par défaut, il faut repartir d'une DB vide (ou resetter le mot de passe via un compte admin/owner existant).

## 3. Environnements

### 3.1 Dev simple (sans Vite HMR)

```bash
npm install --prefix frontend
npm run build --prefix frontend
go run .
```

UI/API servies par le backend sur `http://localhost:8100`.

### 3.2 Dev avec HMR

```bash
make dev
```

- Vite UI: `http://localhost:5173`
- Backend API/WS: `http://localhost:8100`

### 3.3 Build local

```bash
make build
./eve
```

## 4. Installation prod (systemd)

Exécuter en utilisateur normal (pas root):

```bash
./deploy/install.sh
```

Le script:

1. vérifie `multipass`
2. build frontend + backend
3. installe `/usr/local/bin/eve`
4. crée `/etc/eve/eve.env` si absent
5. installe `/etc/systemd/system/eve@.service`
6. active `eve@<user-courant>`

### Vérification service

```bash
systemctl status "eve@$(id -un)"
journalctl -u "eve@$(id -un)" -f
```

## 5. Désinstallation

```bash
sudo ./deploy/uninstall.sh
```

Le script:

- stop/disable les unités `eve@*.service`
- supprime `eve@.service` (et legacy `eve.service`)
- recharge systemd

Il conserve volontairement:

- `/etc/eve/eve.env`
- `/var/lib/eve/`

## 6. Configuration runtime

Exemple de base: `deploy/eve.env.example`.

Variables principales:

- `EVE_BIND`
- `EVE_SESSION_TTL`
- `EVE_JWT_SECRET`
- `EVE_MULTIPASS_BINARY`
- `EVE_MULTIPASS_TIMEOUT`
- `EVE_MULTIPASS_CONCURRENCY`
- `EVE_INSTANCES_CACHE_TTL`
- `EVE_POLL_INTERVAL`
- `EVE_DB_PATH`
- `EVE_ACTIVITY_RETENTION`
- `EVE_LOG_LEVEL`
- `EVE_LOG_FORMAT`
- `EVE_FRONTEND_DIR`

### Variables legacy

`EVE_UI_USERNAME` et `EVE_UI_PASSWORD` ne pilotent plus l'auth actuelle.

## 7. Lancement manuel prod (sans script)

```bash
npm run build --prefix frontend
CGO_ENABLED=0 go build -ldflags="-s -w" -o eve .

export EVE_BIND=0.0.0.0:8100
export EVE_DB_PATH=/var/lib/eve/eve.db
export EVE_JWT_SECRET="$(openssl rand -base64 32)"

./eve
```

## 8. Troubleshooting

### 8.1 "authentication required"

- Vérifier que tu t'es bien connecté via `/auth/login`
- Vérifier que le cookie de session est présent

### 8.2 "invalid credentials"

- Si premier démarrage sur DB vide: `eve / vap0r`
- Sinon: identifiants déjà personnalisés en base

### 8.3 Multipass introuvable

- Vérifier `which multipass`
- Ou définir `EVE_MULTIPASS_BINARY` (chemin absolu)

### 8.4 Le service ne démarre pas

```bash
journalctl -u "eve@$(id -un)" -n 200 --no-pager
```

Vérifier aussi:

- droits sur `EVE_DB_PATH`
- présence de Multipass dans le PATH du service
- syntaxe du fichier `/etc/eve/eve.env`

## 9. Sécurité minimale recommandée

1. Changer immédiatement le mot de passe du compte `eve`.
2. Définir explicitement `EVE_JWT_SECRET` en prod.
3. Exposer Eve derrière un reverse proxy HTTPS (Nginx/Caddy/Traefik).
4. Restreindre l'accès réseau (LAN/VPN, pas Internet public direct).

## 10. Commandes utiles

```bash
# Dev
make dev

# Build + run local
make build
make run

# Install / uninstall
make install
make uninstall

# Logs / status
make service-status
make logs
```
