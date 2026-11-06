# Booster Club

Fangame de collection de cartes Pokémon, sans monétisation. On ouvre des boosters de vraies extensions, on complète son classeur et on compare ses collections avec ses potes.

## Ce que fait le jeu

- **Comptes** : pseudo + mot de passe (chiffré avec bcrypt), session de 30 jours.
- **Boutique** : 10 extensions (Set de Base, Jungle, Fossile, Évolution Céleste, Écarlate et Violet, 151, Étincelles Déferlantes, Évolutions Prismatiques, Méga-Évolution, Flammes Fantasmagoriques).
- **Ouverture animée** : on déchire le booster en glissant le doigt ou la souris le long du haut (ou en cliquant), puis on révèle les cartes une par une. Les rares brillent avant d'être retournées. Selon la rareté : effet holo qui suit la souris, particules, rayons de lumière, flash, sons.
- **Vraies raretés** : composition des boosters proche des vrais (Wizards : 11 cartes avec 1 holo sur 3 ; Épée et Bouclier ; Écarlate et Violet avec Illustration Rare / Spéciale / Hyper Rare ; Méga Hyper Rare). Il y a aussi un **booster divin** (1 chance sur 400) qui ne contient que des grosses cartes.
- **Pokédollars (₽)** : 1 000 au départ, un bonus quotidien de 300 à 600 selon la série de jours, un booster gratuit toutes les 8 h, et la revente des doublons (on garde toujours un exemplaire).
- **Classeur** : une page par extension avec les cartes manquantes en gris, le % de complétion, des filtres et la recherche. Un clic ouvre la fiche de la carte en grand, avec effet 3D et holo.
- **23 succès** avec récompenses (Le Graal = Dracaufeu holo du Set de Base, Pika-fan, Booster divin…).
- **Classement** entre joueurs, avec la possibilité de visiter le classeur des autres, et un fil « Derniers gros tirages » dans la boutique.

Tout est calculé côté serveur (tirages, pièces, ventes), donc personne ne peut tricher depuis son navigateur.

---

## 1. Lancer le jeu sur ton PC

1. Installe **Node.js** en version 22.13 ou plus récente : <https://nodejs.org> (prends la version « LTS »).
2. **Windows** : double-clique sur `Lancer-le-jeu.bat`. Il installe ce qu'il faut au premier lancement, démarre le serveur et ouvre le jeu dans ton navigateur.
   **Autre système**, ou en ligne de commande, dans le dossier du jeu :
   ```
   npm install
   npm start
   ```
3. Crée ton compte.

> **Garde la fenêtre noire ouverte pendant que tu joues.** C'est elle qui fait tourner le serveur du jeu : si tu la fermes, le site reste affiché mais plus rien ne marche (connexion, boosters…). Pour arrêter le jeu, ferme-la quand tu as fini.

Les sauvegardes sont stockées dans le fichier `booster-club.db`. Pour tout remettre à zéro, supprime ce fichier. En cas de problème, les erreurs sont aussi écrites dans `erreurs.log`.

## 2. Jouer avec tes potes (mise en ligne gratuite)

La solution la plus simple et gratuite combine **Render** (qui fait tourner le site) et **Turso** (qui garde les sauvegardes en ligne).

**a. Mettre le code sur GitHub**
Crée un dépôt sur <https://github.com>, puis envoie-y le dossier du jeu (sans `node_modules`). Le bouton « uploading an existing file » suffit.

**b. Créer la base de données (Turso)**
1. Inscris-toi sur <https://turso.tech>, puis crée une base de données.
2. Récupère son **URL** (elle commence par `libsql://…`) et crée un **token**. Tu les trouveras dans la page de la base, rubrique « Connect ».

**c. Mettre le site en ligne (Render)**
1. Inscris-toi sur <https://render.com> avec ton compte GitHub.
2. Clique sur **New → Blueprint** et choisis ton dépôt. Le fichier `render.yaml` remplit tout seul la configuration.
   Tu peux aussi passer par New → Web Service, avec Build `npm install`, Start `npm start` et l'offre Free.
3. Renseigne les deux variables d'environnement :
   - `TURSO_DATABASE_URL` = l'URL de ta base
   - `TURSO_AUTH_TOKEN` = le token
4. Render te donne une adresse du type `https://booster-club-xxxx.onrender.com`. Envoie-la à tes potes.

> Sur l'offre gratuite de Render, le site se met en veille après 15 minutes sans visite. La visite suivante met environ une minute à le réveiller. Les sauvegardes ne sont pas touchées puisqu'elles sont chez Turso.

**Autre option : héberger depuis ton PC.** Lance le jeu, puis crée un tunnel, par exemple avec Cloudflare : `cloudflared tunnel --url http://localhost:3000`. Tu obtiens une adresse publique temporaire. Tes potes ne peuvent jouer que pendant que ton PC est allumé et que le jeu tourne.

## 3. Régler le jeu

| Quoi | Où |
|---|---|
| Prix des boosters, couleurs, ordre des extensions | `data/sets-config.json` |
| Pièces de départ, bonus quotidien, délai du booster gratuit, chance du booster divin | `game.js`, bloc `ECONOMY` |
| Prix de revente par rareté | `game.js`, bloc `TIERS` (`value`) |
| Taux de tirage (composition des boosters) | `game.js`, bloc `TEMPLATES` |
| Succès et récompenses | `game.js`, bloc `ACHIEVEMENTS` |

Relance le serveur après chaque modification.

## 4. Ajouter une extension

Les cartes viennent de la base libre **TCGdex** (<https://github.com/tcgdex/cards-database>).

```
git clone --depth 1 https://github.com/tcgdex/cards-database.git ../cards-database
```

1. Ajoute une ligne dans `data/sets-config.json`. `folder` correspond au chemin du dossier dans `cards-database/data`, avec les noms anglais, par exemple `"Sword & Shield/Lost Origin"`. `template` vaut `wotc`, `swsh`, `sv` ou `me` selon l'époque.
2. Lance `npm run build-data` pour régénérer `data/cards.json`.

## Structure

```
server.js            serveur + API (comptes, boosters, ventes, succès, classement)
game.js              règles : raretés, boosters, économie, succès
db.js                base de données (fichier local ou Turso)
data/cards.json      les 1 680 cartes (généré)
data/sets-config.json les extensions en boutique
scripts/build-data.mjs  génère cards.json depuis TCGdex
public/              le site (HTML, CSS, JS, polices)
```

## Mentions

Fangame non officiel et non commercial, fait pour s'amuser. Pokémon et les cartes Pokémon appartiennent à Nintendo, Creatures Inc. et GAME FREAK. Les images et les données des cartes viennent de TCGdex. Ne monétise pas ce projet. Polices Lilita One et Nunito sous licence SIL OFL.

## Idées pour la suite

- Échanges de cartes entre joueurs
- Liste de souhaits et notification quand un pote obtient une carte que tu cherches
- Événements limités (booster du week-end, taux boostés)
- Profil avec avatar (ta carte préférée) et vitrine des plus belles cartes
