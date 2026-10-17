# Barba-vania: project requirements

These rules apply to every change in this repository.

## The launcher is a permanent requirement

- `PLAY BARBA-VANIA.bat` is the player's one-click entry point. The game lives at `D:\Barba-vania`. Double-clicking the launcher must fetch the newest safe version of the game and open `index.html`.
- Do not remove, replace, rename, bypass, or break the launcher or its update logic unless the project owner explicitly asks for that change.
- Keep the repository launchable from `D:\Barba-vania` with no new manual steps.
- If a change adds a build step, a local server requirement, a dependency install, or a different startup command, update `PLAY BARBA-VANIA.bat` (and the README run instructions) in that same change.
- Keep the game a static, no-build page that `index.html` can open directly unless the owner asks otherwise. Scripts are classic `<script>` tags loaded in the order set in `index.html`; keep that order when adding files.

## Working conventions

- Work on branch `claude/magical-hopper-7npp9w`. Do not open a pull request unless asked.
- Run `npm test` (dependency-free level checks) before committing gameplay or map changes. `npm run test:browser` drives the game in headless Chromium and needs Playwright.
- Keep the level map in `js/level-data.js` consistent with the legend at the top of that file.
