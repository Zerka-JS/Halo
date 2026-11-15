# Halo

## Lancer (Linux)
Prérequis Tauri 2 (Debian/Ubuntu) :
`sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev playerctl x11-utils`
puis `npm install` et `npm run tauri dev` (ou `npm run tauri build` : paquets .deb / AppImage).
La lecture en cours (widget Spotify, barre du haut) utilise `playerctl` ; sans lui le widget indique comment l'installer.
Pour les fonds d'écran **vidéo (MP4)** et **son (MP3)**, WebKitGTK a besoin des codecs GStreamer :
`sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav` (sans eux, la vignette affiche « Vidéo illisible »).

## Lancer (Windows)
**Important : une ancienne version de Halo encore en cours d'exécution (ou un ancien .exe) garde ses anciens défauts ; il faut la fermer puis recompiler.**
1. `taskkill /F /IM halo-desktop.exe`   (si une ancienne instance tourne)
2. `npm install`
3. `npm run tauri dev`        (développement)
   `npm run tauri build`      (version finale : sans outils de développement)

La première compilation Rust est longue ; elle récupère aussi les nouvelles dépendances.

**Écran blanc ?** Halo affiche maintenant l'erreur à l'écran (bouton « Copier l'erreur ») au lieu d'un écran blanc, et un widget en erreur n'empêche plus le reste du bureau de s'afficher. Après 12 s sans rien d'affiché, un message indique quoi vérifier (ancienne instance, port 1420).

## Obtenir le .exe via GitHub (sans installer Rust)
Pousse le **contenu du dossier `halo`** (là où se trouve `package.json`) à la racine d'un dépôt GitHub, puis onglet **Actions › Build Halo › Run workflow**
(ou pousse un tag `v0.2.0`). Au bout de quelques minutes, l'exécution propose en bas de page l'archive **halo-windows** :
l'installeur `Halo_…_x64-setup.exe` (c'est lui qu'il faut lancer pour l'option « démarrer avec Windows ») et `halo-desktop.exe`.
L'exécutable n'est pas signé : SmartScreen affiche « Windows a protégé votre PC » → **Informations complémentaires › Exécuter quand même**.
Le job `linux` produit de la même façon le `.deb` et l'AppImage.

## Mode "shell"
Au démarrage, Halo masque la barre des tâches Windows et réserve l'espace de la barre du haut et du dock.
**La touche Windows est désactivée tant que Halo tourne** (Windows seule et tous les raccourcis Win+…) : elle ferait réapparaître le menu
Démarrer et la barre des tâches par-dessus Halo. Elle revient d'elle-même dès qu'on quitte Halo (menu **Halo > Quitter Halo**).
**Ctrl + Échap** (qui ouvre aussi le menu Démarrer) est bloqué lui aussi ; Ctrl + Maj + Échap (gestionnaire des tâches) reste disponible.
Utilise la loupe (Alt + Espace) à la place, voir plus bas. (Windows uniquement.)
La barre des tâches Windows est recachée automatiquement (vérification chaque seconde) si Windows la réaffiche.
Quitter proprement : menu **Halo > Quitter Halo** (la barre Windows revient toute seule).
Si la barre reste cachée après un arrêt brutal : double-clic sur `restaurer-windows.bat`.
Ce mode se désactive aussi dans **Réglages > Système**.

## Plusieurs écrans
Halo affiche la barre du haut, le dock et le fond d'écran sur **chaque écran** (créés automatiquement au démarrage,
et à chaud quand tu branches / débranches un écran ou changes sa résolution). Les widgets restent sur l'écran principal.
Chaque fenêtre est replacée au pixel près sur son écran (Halo mesure la zone réellement affichée par Windows et corrige l'écart) privée de tout cadre Windows (barre de titre, bordures : les barres « Halo Barre » et « Halo Dock » ne peuvent plus apparaître, un garde-fou impose le style « fenêtre nue » (WS_POPUP, sans titre ni bordure), une zone non cliente de 0 pixel, bloque le dessin de la barre de titre par Windows, et un veilleur le revérifie toutes les 250 ms), puis **découpée** à la taille exacte de son écran : plus rien ne peut dépasser sur l'écran voisin. Les fonds d'écran sont revérifiés toutes les 3 s.
Sous Windows, le mode « shell » (barre des tâches masquée) s'applique aux deux écrans ; la zone de travail réservée
(barre + dock) ne concerne que l'écran principal.

## Plein écran, « plein écran fenêtré » et fenêtres agrandies
La barre du haut et le dock s'effacent, **sur l'écran concerné seulement**, dans deux cas :
1. **Plein écran** : jeu (y compris en « plein écran fenêtré » / sans bordure), vidéo, navigateur en F11, diaporama… Les barres reviennent dès que tu quittes le plein écran.
2. **Fenêtre agrandie** (bouton □, titre et bordures conservés), par défaut. Désactivable dans **Réglages › Système › Masquer aussi quand une fenêtre est agrandie**.
   La zone de travail passe alors à l'écran entier : la fenêtre le remplit vraiment (pas de bandes vides en haut et en bas) et reprend sa place dès que les barres reviennent.
   **Pour rappeler les barres** sans quitter la fenêtre : pousse la souris contre le **bord du bas** (le dock apparaît) ou contre le **bord du haut** en y restant
   ~0,6 s (la barre du haut ; ce délai évite qu'elle surgisse quand tu vises les boutons de la fenêtre). Elles repartent ~0,5 s après que la souris les a quittées.
   Ce rappel n'existe pas en vrai plein écran (un jeu se sert des bords de l'écran).

**Comment Halo décide** (il ne regarde plus seulement la fenêtre qui a le focus) : pour chaque écran, il parcourt les fenêtres de haut en bas
et la première qui occupe l'essentiel de l'écran (60 % ou plus) décide :
- elle recouvre tout l'écran (à 3 px près), ou, si elle n'a ni titre ni bordure, toute la zone de travail → plein écran ;
- elle est agrandie (et l'option ci-dessus est active) → fenêtre agrandie ;
- sinon (fenêtre ordinaire, même grande ; fenêtres côte à côte ; bureau) → barres visibles.

Conséquences : changer de focus (clic sur une barre, autre écran, notification) ne fait plus revenir les barres ; une vidéo en plein écran sur le 2ᵉ écran
masque les barres de cet écran même si tu travailles sur le 1ᵉʳ ; une fenêtre ordinaire posée **par-dessus** un jeu ou une fenêtre agrandie les fait revenir.
Une petite fenêtre au-dessus (boîte de dialogue, lecteur flottant) ne change rien. Sont ignorés : les fenêtres de Halo, les fenêtres réduites ou sur un autre
bureau virtuel, le bureau Windows et les overlays (Steam, Nvidia, Discord, Game Bar… : fenêtres d'outils, transparentes aux clics ou qui ne prennent pas le focus).
Pour ne pas clignoter, les barres se masquent tout de suite mais ne reviennent qu'après ~0,45 s sans plein écran ni fenêtre agrandie, et un filet de sécurité
remasque toute barre qui réapparaîtrait par erreur.

- **Windows** : relevé toutes les 150 ms (`EnumWindows`). Le mode « shell » (barre Windows masquée) doit être actif pour que la zone de travail suive ; sans lui,
  Windows garde la sienne et seules les barres de Halo s'effacent.
- **Linux (X11 / XWayland)** : pile des fenêtres `_NET_CLIENT_LIST_STACKING`, état `_NET_WM_STATE_FULLSCREEN` / `MAXIMIZED_*` (ou fenêtre sans décoration qui couvre l'écran),
  avec `xprop` et `xwininfo` (paquet `x11-utils`). Relevé toutes les 500 ms. Sous Wayland pur, seules les applications XWayland sont vues.

**Si une application ne se comporte pas comme prévu** : ouvre `%APPDATA%\dev.halo.desktop\fullscreen.log` (Linux : `~/.config/dev.halo.desktop/fullscreen.log`).
Halo y note, à chaque changement de fenêtre dominante sur un écran, laquelle il a retenue (classe, titre, taille, style) et sa décision.
Envoie-moi les lignes concernées : elles disent exactement ce que l'application déclare, et donc quoi ajuster.

Désactivable entièrement dans **Réglages › Système › Masquer la barre et le dock en plein écran**.

## Alimentation
Le bouton **⏻** tout à droite de la barre du haut (après l'heure) ouvre le menu d'alimentation : **Verrouiller**, **Mettre en veille**,
**Se déconnecter**, **Arrêter**, **Redémarrer**. Arrêter, Redémarrer et Se déconnecter demandent un second clic (« Cliquer pour confirmer »).
Windows : `shutdown /s | /r | /l` (sans forcer : une application qui a un document ouvert peut encore demander à le garder), veille via `SetSuspendState`.
Linux : `systemctl suspend | poweroff | reboot` et `loginctl lock-session`. La barre des tâches est rendue à Windows avant l'arrêt, le redémarrage ou la déconnexion.
Les variantes « Mettre à jour et arrêter / redémarrer » de Windows ne sont pas reprises : l'arrêt passe par la commande standard.

## Applications en arrière-plan (la flèche ^)
La petite flèche **^** de la barre du haut (à gauche de l'icône réseau) remplace celle de la barre des tâches Windows : elle liste les programmes
qui tournent **sans fenêtre ouverte** (ceux qui vivent dans la zone de notification : lanceurs de jeux, synchronisation, Discord réduit, etc.).
Pour chacun : **Ouvrir** (relance le programme, qui ramène en général sa fenêtre) et **Fermer** (second clic « Confirmer » ; ferme toutes ses instances).
Limite : Halo ne peut pas reprendre le vrai menu clic droit des icônes de notification (Windows le garde pour sa barre des tâches) : on ouvre ou on ferme le programme.
Les programmes du dossier Windows, l'explorateur et Halo lui-même n'apparaissent pas. Windows uniquement (la flèche est masquée sous Linux).

## Animations et fluidité (Réglages › Animations)
- **Niveau d'animation** : *Complètes* (ressorts, rebonds, fondus, fonds animés), *Réduites* (mouvements courts, sans rebond, fonds figés) ou *Aucune* (tout est instantané).
  **Vitesse** de 50 % à 200 % : elle règle d'un coup les menus, le dock, les pages de Réglages et les widgets.
- **Transition entre deux fonds d'écran** : active l'effet choisi dans Réglages › Fond d'écran (Cercle, Balayage, Points, Fondu ou Aucune).
- **Mode de performance** : *Qualité*, *Équilibré* (tes réglages tels quels) ou *Économie* (flou plafonné à 10 px, pas de saturation, fusion de calques désactivée, fond animé à 15 images/s).
- **Fréquence d'actualisation** : applications ouvertes du dock (1 à 15 s) et réseau / batterie de la barre du haut (5 à 120 s).
- Les curseurs sont plus fluides (la valeur suit la souris à chaque image, le réglage est appliqué une fois par image) ; **double-clic sur un curseur** ou bouton **↺** = valeur d'origine.
- L'horloge de la barre du haut se met à jour pile à la seconde (ou à la minute si les secondes sont masquées) : plus de dérive, moins de calculs.
- Le dock ne redimensionne plus sa fenêtre à chaque pixel quand tu fais glisser un curseur de taille ou d'espacement.

**Nouveaux réglages détaillés**
- *Apparence* : saturation, contour et ombre du verre ; style de la date (court / long / numérique / aucune) et jour de la semaine.
- *Dock* : espacement, portée et souplesse de la loupe (doux / normal / vif), rebond au lancement, délai des infobulles, arrondi des icônes et de la barre.
- *Fond d'écran* : saturation, vignette, vitesse des animations du fond, images par seconde (15 / 30 / 60).
Mise à jour 100 % interface : aucune recompilation Rust nécessaire, un simple `npm run tauri dev` suffit après avoir fermé Halo.

## Panneau Réglages
Ouvrir : menu **Halo** (barre du haut) > Réglages, clic droit sur le bureau, ou l'icône réglages à droite du dock.
**Recherche** : `Ctrl + K` (ou le champ en haut à gauche) cherche dans tous les réglages, par nom ou par description ; Entrée ouvre la page et met le réglage en surbrillance. `Ctrl + Page ↑ / ↓` change de page. Chaque page a son bouton **Rétablir cette page**.

- **Fond d'écran** : choix en **carrousel 3D** (← → pour parcourir, ↑ ↓ pour changer de catégorie, Entrée ou clic sur la carte centrale pour appliquer) : **Ma collection** (tes liens d'images, tes fichiers importés), 9 fonds sobres et une section « Illustrations ».
  Effets de transition (Cercle, Balayage, Points, Fondu, Aucune), assombrissement, flou, animations, variantes.
  - **Vidéo (MP4, WebM) et son (MP3, M4A, OGG, WAV) en fond** : « Importer un fichier » (plusieurs à la fois). Les fichiers sont copiés dans `%APPDATA%\dev.halo.desktop\wallpapers\` ; la croix au survol de la vignette les supprime.
    La vidéo est lue en boucle (muette par défaut) ; le MP3 tourne en boucle avec un visualiseur. Le son n'est joué que par l'écran principal.
  - **Ajouter un fond par lien** : colle l'adresse d'une image dans « Ajouter par lien », ou remplis `src/lib/wallpaper-links.ts`.
- **Apparence** : thème, couleur d'accent, **police** (Inter, Windows, serif, monospace), **styles prêts à l'emploi** (Verre, Cristal, Doux, Mat, Plat), opacité, flou, arrondi, saturation / contour / ombre du verre, **accessibilité** (contraste renforcé, transparence réduite).
- **Barre du haut** : aperçu en direct ; fond (verre / opaque / transparent), taille du texte, espacement ; éléments affichés un par un (recherche, réseau, volume, batterie et pourcentage, centre de contrôle, heure, alimentation) ;
  molette sur le volume, confirmation avant d'éteindre ; tuiles du centre de contrôle ; heure et date (12 / 24 h, secondes, style, **langue**).
- **Dock** : icônes (↑ ↓ ou glisser-déposer), applications ouvertes non épinglées, **style de l'indicateur** (point / trait / halo), séparateur, fond, nombre de fichiers dans Téléchargements, loupe, espacement, arrondis.
- **Widgets** : afficher / masquer tous les widgets, widgets sur tous les écrans, **grille magnétique**, opacité globale, menu du clic droit ; options de chaque widget, **dupliquer**.
- **Recherche** : moteur web (Google, Bing, DuckDuckGo, Qwant, Ecosia, Brave, Startpage, ou adresse personnalisée avec `%s`), liens, raccourcis Halo, **calculatrice** (`12*3,5`, `(2+3)^2`, `sqrt(81)`, `20%`), **commandes système** (verrouiller, veille, redémarrer, arrêter, thème ; confirmation par un second Entrée), nombre de résultats, historique.
- **Raccourcis** : raccourcis **globaux** (marchent partout dans Windows) pour la recherche (Alt + Espace par défaut), les réglages, l'édition des widgets, le fond d'écran suivant / précédent, le thème clair / sombre et le mode muet. Clique sur un champ puis tape la combinaison ; la page signale les doublons et les combinaisons déjà prises.
- **Animations** : niveau, vitesse, performances (Qualité / Équilibré / Économie), **économie automatique sur batterie**, **mesure de fluidité**, fréquence d'actualisation.
- **Système** : barre Windows, plein écran, lancement au démarrage, **sauvegarde** (exporter en fichier ou presse-papiers, importer), réinitialisation **par catégorie**, dossier de configuration, diagnostic.

**Fluidité (v15)** : chaque fenêtre ne se redessine plus que pour les réglages qu'elle utilise ; les changements de curseur ne diffusent plus les icônes encodées entre fenêtres ; le flou inutile des fenêtres transparentes (barre, dock, recherche) est retiré ; les aperçus et animations de la fenêtre Réglages se mettent en pause quand elle est masquée.
Mise à jour 100 % interface : aucune recompilation Rust, un simple `npm run tauri dev` suffit après avoir fermé Halo. Les anciens `settings.json` restent compatibles.

Les réglages sont enregistrés dans `%APPDATA%\dev.halo.desktop\settings.json` (images importées dans `wallpapers\`).

## Recherche d'applications (la loupe)
Pour lancer une application sans la touche Windows (qui refait apparaître la barre des tâches) :
- clique sur la **loupe** dans la barre du haut ou dans le dock, ou tape **Alt + Espace** (modifiable dans Réglages › Raccourcis) ;
- tape quelques lettres (accents ignorés, « vsc » trouve Visual Studio Code), **↑ ↓** pour choisir, **Entrée** pour lancer, **Échap** pour fermer ;
- même liste que le menu Démarrer (applications classiques et du Store) ; tape un lien pour l'ouvrir, ou n'importe quoi d'autre pour le chercher sur le web
  (moteur modifiable dans Réglages › Recherche) ;
- chaque résultat affiche la **vraie icône** de l'application (Win32 et Store). Elles sont extraites une seule fois en tâche de fond
  puis gardées dans `%APPDATA%\dev.halo.desktop\app-icons.json` : pendant la toute première extraction, une pastille à initiale s'affiche, remplacée en direct ;
- la recherche s'ouvre **juste au-dessus du dock**, sur **l'écran où se trouve la souris** : le champ de saisie reste en bas et les résultats s'empilent au-dessus ;
- les applications les plus lancées remontent en premier. La loupe du dock se masque dans Réglages › Dock.

## Widgets
- **Spotify · En lecture** — style **« Île »** (par défaut, en haut au centre sous la barre) :
  - **Petite version** : égaliseur (il danse pendant la lecture), heure au centre et miniature de la pochette. Quand une musique démarre ou
    qu'un nouveau morceau est détecté, le titre remplace l'heure pendant ~4,5 s.
  - **Clic** : la pastille se transforme en lecteur (pochette, titre, artiste, précédent / pause / suivant, progression cliquable, volume :
    clic = muet, molette = volume). Sans lecture, elle propose d'ouvrir Spotify.
  - **Retour à la petite version** : quand la souris s'éloigne (~0,65 s), au clic ailleurs, avec **Échap**, ou quand une autre fenêtre prend le focus.
  - Réglages › Widgets › Spotify : centre de la pastille (heure / titre / temps écoulé), « se réduit quand la souris s'éloigne » (désactivable),
    accent aux couleurs de la pochette (sinon blanc), boutons, barre de progression, source. Les autres styles (carte adaptative, compact, pochette,
    texte seul) restent disponibles dans la liste « Style ». Un ancien widget Spotify jamais modifié passe automatiquement en île.
  - Mise à jour 100 % interface : aucune recompilation Rust, un simple `npm run tauri dev` après avoir fermé Halo.
- **Spotify · En lecture** (autres styles) : titre, pochette, progression (clic pour se déplacer), précédent / pause / suivant.
  La carte **s'adapte à chaque morceau** : les couleurs dominantes de la pochette donnent le fond en dégradé, la couleur
  d'accent (barre, bouton lecture, égaliseur) et l'ombre sous la pochette ; elles changent en douceur d'un titre à l'autre.
  4 styles (carte adaptative, compact, pochette, texte seul). Aucun compte développeur ni clé API.
  - **Windows** : contrôles média de Windows (SMTC) ; l'application Spotify de Windows (ou Spotify Web) suffit.
    Si Windows n'expose pas la session, repli sur le titre de la fenêtre Spotify.
  - **Linux** : MPRIS (D-Bus) via **`playerctl`** (à installer : `sudo apt install playerctl` · `sudo pacman -S playerctl` ·
    `sudo dnf install playerctl`). Fonctionne avec Spotify, VLC, mpv, Rhythmbox, Firefox/Chromium (Spotify Web, YouTube)…
    La pochette est téléchargée par Halo (adresse https de Spotify ou fichier local) puis envoyée au widget.
  - **Pochette de secours (Windows et Linux)** : si le lecteur ne fournit aucune pochette au bout de ~3,5 s, Halo la cherche
    par artiste + titre via l'API de recherche iTunes (publique, sans clé ; utilise `curl`, présent dans Windows 10/11).
    Seule une correspondance exacte titre + artiste est acceptée : pas de pochette plutôt qu'une mauvaise.
  Par défaut le widget suit **toute application média** (Spotify prioritaire quand il joue) ; « Spotify uniquement » est une option.
  Quand rien ne s'affiche, la carte indique ce que le système voit (ou l'erreur rencontrée).
- **Spotify · Lecteur intégré** : colle un lien de playlist / album / artiste / titre / podcast.
  (Connecte-toi à Spotify dans le lecteur pour écouter en entier ; sinon extraits de 30 s.)
- **Indicateur de son** (le rond en haut à droite) : réagit au niveau réel du son, mesuré sur **toutes** les sorties audio
  actives de Windows (utile avec Voicemeeter, Sonar, FxSound… qui envoient le son vers une autre sortie que celle par défaut).
  3 styles (disque, anneau, barres). Clic = muet, molette = volume.
- Horloge (grande / compacte / analogique), calendrier, système (CPU/RAM), notes.

## Diagnostic (si le son ou Spotify ne s'affichent pas)
Double-clic sur `diagnostic-halo.bat` pendant qu'un morceau joue : il mesure le niveau de chaque sortie audio, liste ce que
Windows voit de Spotify, et écrit le tout dans `halo-diagnostic.txt`.

## Elgato Wave Link (indicateur de volume)
Avec Wave Link, la sortie par défaut de Windows est une carte virtuelle (« Wave Link Stream » / « System ») : son volume Windows ne change pas le vrai son.
Dans **Réglages › Système › Son et Spotify**, un message dit en clair ce que Halo voit (« Wave Link détecté… », sortie pilotée, ou la cause si le démon audio n'a pas pu charger la nouveauté). Le réglage **Sortie du volume** est sur « Automatique » par défaut ; tu peux aussi choisir :
- **Automatique** : si Wave Link est la sortie par défaut, Halo suit la première vraie sortie (casque, enceintes) ;
- ou directement **ta vraie sortie** dans la liste (c'est le choix le plus fiable si tu as plusieurs sorties).
L'icône de volume, son curseur, la molette et le bouton muet pilotent alors cette sortie. Le niveau animé continue d'écouter toutes les sorties, Wave Link compris.

**Choisir la sortie depuis le widget « Indicateur de son »** : dans ses options (Réglages › Widgets, ou clic sur le widget en mode édition), la liste **Sortie audio (casque, enceintes…)** est le même choix que ci-dessus. Le nom de la sortie s'affiche au survol du widget. L'option **Animer uniquement avec cette sortie** fait réagir l'animation seulement au son qui part vers la sortie choisie (sinon, elle écoute toutes les sorties comme avant). Cette nouveauté touche le démon audio : ferme complètement Halo (zone de notification comprise) et relance-le.
Cette mise à jour touche le démon audio et un peu de Rust : ferme Halo puis relance `npm run tauri dev` (recompilation normale).

## Son, volume, luminosité
Un petit processus PowerShell résident (`src-tauri/src/sys.ps1`) lit le niveau audio, le volume et les contrôles média.
Le curseur Volume du centre de contrôle règle le vrai volume Windows ; la luminosité fonctionne sur les écrans de portable.
