<p align="center">
  <img src="build/logo.svg" width="128" alt="SpeedTest">
</p>

<h1 align="center">SpeedTest</h1>

<p align="center">
  Test de débit internet moderne — ping, gigue, téléchargement et envoi.<br>
  Disponible pour <b>Mac</b>, <b>Windows</b> et en <b>site web</b>.
</p>

<p align="center">
  <a href="https://github.com/enzo78360/speedtest/releases/latest"><b>⬇ Télécharger</b></a> ·
  <a href="https://enzo78360.github.io/speedtest/"><b>🌐 Version web</b></a>
</p>

---

## Installation

Rendez-vous sur la page [Releases](https://github.com/enzo78360/speedtest/releases/latest) :

| Système | Fichier |
| --- | --- |
| macOS (Intel et Apple Silicon) | `SpeedTest-x.y.z-mac-universal.dmg` |
| Windows | `SpeedTest-x.y.z-Windows-Setup.exe` |

> L'application n'est pas signée (certificats payants), le système affiche donc un avertissement au premier lancement :
> - **Mac** : clic droit sur l'app → **Ouvrir** → **Ouvrir**. Si macOS dit que l'app est « endommagée », lancer dans le Terminal :
>   `xattr -cr /Applications/SpeedTest.app`
> - **Windows** : « Windows a protégé votre ordinateur » → **Informations complémentaires** → **Exécuter quand même**.

## Fonctionnement

Les mesures utilisent les serveurs publics de Cloudflare (`speed.cloudflare.com`) :
ping (médiane de 11 requêtes), puis 10 s de téléchargement et 10 s d'envoi sur 4 connexions parallèles.
Les 2 premières secondes de chaque phase sont ignorées pour ne pas pénaliser la montée en charge.

- `web/` — l'application (HTML/CSS/JS, aucune dépendance), aussi publiée telle quelle en site web.
- `desktop/main.js` — la fenêtre Electron qui emballe `web/` pour Mac et Windows.
- `.github/workflows/` — compilation automatique des apps et publication du site.

## Vie privée (RGPD)

Aucun compte, aucun cookie, aucune statistique ni publicité, donc pas de bandeau de consentement.
L'adresse IP n'est transmise à Cloudflare qu'au moment où l'on lance un test (information affichée sous la jauge).
L'historique est **désactivé par défaut** et, si on l'active, reste uniquement sur l'appareil.
Détails : [politique de confidentialité et mentions légales](https://enzo78360.github.io/speedtest/confidentialite.html).

## Sécurité

- **App de bureau** : Electron à jour, moteur de rendu isolé (`sandbox`, `contextIsolation`, sans accès à Node.js),
  navigation et pop-ups bloquées, aucune permission accordée (caméra, micro, localisation…), outils de développement
  désactivés, et fusibles Electron verrouillés (`RunAsNode`, `NODE_OPTIONS` et `--inspect` désactivés).
- **Site et app** : Content Security Policy stricte — seuls les scripts de l'app s'exécutent et seul
  `speed.cloudflare.com` peut être contacté. L'historique local est validé et affiché sans HTML.
- **Contrôles automatiques** : `npm audit` et la suite [`tests/security.mjs`](tests/security.mjs) (attaques simulées et contrôles RGPD)
  tournent à chaque push, chaque lundi et avant chaque Release ; une version n'est publiée que si tout passe.
  Dependabot propose les mises à jour de sécurité, et les actions GitHub sont épinglées par empreinte.

```bash
npm run audit           # failles connues dans les dépendances
npm run test:security   # attaques simulées contre l'app
```

## Développement

```bash
python3 -m http.server 8080 --directory web   # site web sur http://localhost:8080
npm install && npm start                      # app de bureau (nécessite Node.js)
```

Publier une nouvelle version : changer `version` dans `package.json`, puis

```bash
git tag v1.0.1 && git push --tags
```

GitHub Actions compile le `.dmg` et le `.exe` et les ajoute à la Release.
