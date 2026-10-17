# Barba-vania

A dark, violent, old-school sword-and-sorcery Metroidvania. This repository holds **Chapter One: The Hollow Dunes**, the first playable zone. The rest of the game is not built yet.

The barbarian uses only his body and his sword. The alien desert at night is painted entirely in code, so the game needs no image or audio files.

## Running it

On Windows, double-click `PLAY BARBA-VANIA.bat`. You can copy this file to
your desktop; it always installs and opens the game at `D:\Barba-vania`,
regardless of where the launcher is stored or which directory is current.
Install [Git for Windows](https://git-scm.com/download/win) first and make
sure drive D: is available. The first run needs an internet connection.

The launcher uses branch `claude/magical-hopper-7npp9w`. Later runs fetch
that branch and update only a clean checkout that can fast-forward. Local
changes, local commits, unexpected repositories, and other branches are
left untouched. If GitHub is unavailable or an update is unsafe, it warns
you and opens the existing `index.html` in your default browser. The command
window stays open until you press a key so you can read the result.

No build step. Open `index.html` in a browser, or serve the folder:

```sh
npx serve .
```

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move | Arrows / WASD | D-pad / left stick |
| Jump (hold for height) | Space / Z / C | A |
| Sword combo (3 hits) | X / J | X |
| Up-slash | Up + attack | Up + X |
| Crouch slash | Down + attack | Down + X |
| Drop through a bone ledge | Down + jump | Down + A |
| Air slash | Attack in mid-air | X in mid-air |
| Down-thrust (bounces off enemies) | Down + attack in mid-air | Down + X in mid-air |
| Pause | P / Esc | Start |

The gamepad mapping is written but has not been tested on hardware.

## Level One

- **Dunes.** The first jackals and the thorn patch. A one-way bone ledge teaches jumping. A raised slab hides the **Blood Torc** (+2 max health), and you strike it from below.
- **Gorge.** A spiked pit, a spine-slinger on a perch, and a razorwing. A **high shelf with a grapple anchor** sits out of reach. That's foreshadowing for a later ability.
- **Bone caverns.** Drop down the shaft, climb the bone stairs, and fight a carrion brute, which slams the sand and sends shockwaves along the ground.
- **Ruined shrine.** An ember priest blinks and hurls homing fire, and guards the **star-sigil** on the altar.
- **Sealed gate.** The sigil opens the gate into the boss arena. Once you're inside, the gate closes behind you.
- **Sandmaw Wyrm.** A burrowing sand-worm that can only be hurt while its head is up. Leap and strike it while it breaches, and dodge the acid it spits.
- **The Dark Star gate.** After the wyrm falls, the cloaked figure appears above the dunes with the dark-haired woman. Her hairpin is left in the sand, and the gate at the end of the arena ends the chapter.

Checkpoints are the stone totems. Dying returns you to the last totem with full health. Progress such as collected items, opened gates, and slain enemies is kept.

## Layout

```
index.html          page shell, script order
js/util.js          shared namespace and helpers
js/input.js         keyboard and gamepad, with latched presses
js/world.js         tile grid, collision for moving bodies, zone and gate state
js/level-data.js    Level One: ASCII map, themes, zone triggers
js/player.js        the barbarian: movement, combo, air and down attacks
js/entities.js      jackal, razorwing, spine-slinger, ember priest, carrion brute, projectiles
js/boss.js          Sandmaw Wyrm
js/art.js           procedural sprites, tiles, sky and parallax backdrop, props
js/fx.js            particles, gore decals, shake, hit-stop, captions
js/game.js          state machine, world loading, checkpoints, camera, HUD
tests/              level structure and reachability checks, browser playthrough
```

The map is an ASCII grid in `js/level-data.js`. The legend is at the top of that file.

## Tests

```sh
npm test                   # level structure and reachability, no dependencies
npm run test:browser       # drives the game in headless Chromium (needs Playwright)
```

`test:browser` expects Playwright. Set `PLAYWRIGHT_MODULE` to its path if it isn't resolvable, and `CHROMIUM_PATH` if Chromium isn't on the default path.

The reachability check is an approximation of the player's jump (3 tiles up, 4 across). It confirms the intended route exists, the high shelf stays out of reach, and the Torc, key, gate, and boss all come in order.
