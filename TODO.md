# TODO (Restant a implementer)

## Dashboard (priorite)
15. Dashboard: ajouter un bloc **Recent Failures** dedie (actions en erreur depuis `activity`), avec lien direct vers la ressource concernee.
16. Dashboard: ajouter des **Template Shortcuts** (`small` / `medium` / `large`) pour lancement rapide depuis le dashboard.
17. Dashboard: ajouter un **Capacity Summary** (configured vs used CPU/RAM/Disk + taux de saturation).
18. Dashboard: ajouter un bloc **Top Consumers** (Top 3 RAM/Disk avec mini tendances recentes).
19. Dashboard: ajouter une **Health Strip** (API, clients WebSocket, poll delay, daemon multipass).
20. Dashboard: faire une **refonte UI** des cards **Cost Estimator** et **History**.
20.1. Repenser la hierarchie visuelle: titre, valeur principale, meta-infos et actions secondaires clairement separees.
20.2. Uniformiser la grille desktop pour aligner hauteurs, paddings, rayons, bordures et densite avec les autres cards dashboard.
20.3. Revoir le responsive mobile: pas de texte coupe, pas de chevauchement, ordre de lecture clair, zones tactiles >= 40px.
20.4. Clarifier les etats: loading (skeleton), empty, erreur, etat normal (sans sauts de layout).
20.5. Ameliorer la lisibilite des tendances/chiffres: contraste, tabular numbers, labels explicites, unites coherentes.
20.6. Ajouter des quick actions utiles dans History (filtres/clear) sans surcharge visuelle.
20.7. Verifier accessibilite: focus visible, navigation clavier, aria labels et support `prefers-reduced-motion`.

## Features restantes (API / Multipass -> UI)
21. **Aliases management**: page UI pour `list/create/delete/prefer` (`/api/aliases`, `/api/aliases/prefer`).
22. **Transfers UI**: interface pour `POST /api/transfers` (source, destination, mode, validation).
23. **Mount manager post-launch**: gerer `mount/umount` sur instance existante (`/api/instances/{name}/mounts`).
24. **Commandes Multipass catalog/help**: UI de consultation de `/api/system/commands` et `/api/system/commands/{command}/help`.
25. **Settings keys explorer**: UI technique pour `/api/settings/keys` + navigation rapide vers edition.
26. **Profile utilisateur courant**: ecran pour `updateCurrentUser` et `changeCurrentPassword`.
27. **Exec runner (advanced)**: action UI pour `api.execInstance` (commande ponctuelle, stdout/stderr, erreurs).
28. **Instance ownership**: definir et exposer l'ownership des instances (owner visible en UI + permissions RBAC sur actions sensibles).
