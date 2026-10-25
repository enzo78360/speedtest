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
