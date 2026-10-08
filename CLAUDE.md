# World Builder

A general-purpose map editor and generator in the browser: `README.md` covers what it does and how
it's hosted. Live at https://world-builder-fc2cf.web.app; pushing to `main` deploys there (GitHub
Actions → Firebase Hosting). Other projects can build on it, so it stays general-purpose.

## Working with the owner

- The owner uses it on an iPhone: everything must work by touch in Safari at 390 px wide, with
  buttons at least 44 px.
- End every message that reports a pushed update with the live link on its own line at the bottom:
  https://world-builder-fc2cf.web.app

## Checks before pushing

```bash
npm run typecheck
npm test
npm run build
```

## Keeping it general-purpose

- Nothing existing may break. Tile and object ids are append-only, and old project files must still
  open (`src/core/project.ts` upgrades them).
- Features for one game switch on per map through a settings key, and live in their own module.
  RPG-DC's key is `settings.rpgdcMapId`; its code is in `src/core/rpgdc/` and `src/ui/gameUi.ts`.
  Maps without the key behave as plain World Builder maps. Another game would get its own key,
  module, export and doc in the same way.
- Projects are saved in each user's browser and in Firestore, not in this repo. When the meaning of
  saved data changes, upgrade it when the project opens, once, behind a version kept in the map's
  settings (see `PLACES_VERSION` in `src/core/rpgdc/migrate.ts`).

## RPG-DC

The game lives in its own repo, [RavenArcher17/RPG-DC](https://github.com/RavenArcher17/RPG-DC).
It reads the **RPG-DC maps** export (`docs/rpgdc-export.md`) in `shared/src/mapfile.ts` and runs the
same checks as **Check for game**. When the format or a rule changes, change both repos together.
The game's own copy of the maps is `shared/maps/rpg-dc.maps.json`; `tests/fixtures/rpg-dc.world.json`
here is the project that produced it.
