# Nightshift — Driving Game

A first-person driving game set on a wet, winding highway at dusk. Sit inside a minimal
cockpit, chase the sodium lights and bank clean sectors to upgrade the car. Everything in
the scene — road, skyline, streetlights, lamps, textures, engine and tyre audio — is
generated at runtime. No models, images or audio files are downloaded.

Built with Three.js, [cannon-es](https://github.com/pmndrs/cannon-es) `RaycastVehicle`,
React 19, Tailwind CSS v4 and Vite.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL. `npm run build` typechecks and emits a static bundle in `dist/`.

## The drive

- **Cockpit camera** — 80° PerspectiveCamera inside a modelled interior with a dashboard,
  binnacle, windscreen frame, mirror and a steering wheel that turns with the front wheels.
- **Camera feel** — spring lag, 2° of head tilt into corners, forward pitch under braking,
  speed-scaled micro-vibration and dynamic FOV that opens from 80° to 94° at speed.
- **Lighting** — dusk sky shader with a sun glow and moon, high-contrast sodium streetlights,
  wet asphalt with clearcoat and roughness puddles, coloured traffic signal reflections and
  two shadow-casting headlight spotlights on the front bumper.
- **Driving** — cannon-es raycast suspension, a six-speed automatic with a torque curve,
  braking, reverse, a handbrake that breaks the rear tyres loose, and self-centering steering.
  Aerodynamic drag and rolling resistance keep top speed honest.
- **World** — a closed 1.6 km spline highway with lane markings, guardrails, lamp arrays,
  three signal gantries, twelve sector arches, a night skyline and distant ridges.
- **HUD** — digital speedometer (km/h or mph), gear, tachometer, lap and sector progress,
  credits and level. No superfluous panels while driving.

## Progression

Clear the twelve sector gates around the loop. Each gate pays credits and XP based on speed;
crossing a gate without touching a guardrail earns a clean-line bonus. Complete all twelve for
a lap bonus and a saved best lap. XP raises your driver level, and each upgrade stage unlocks
at the matching level. Credits buy four upgrade lines in the garage:

| Upgrade | Effect |
| --- | --- |
| Engine | More torque and top end |
| Tyres | More lateral grip in the wet |
| Brakes | Stronger stopping force |
| Lights | Brighter, longer headlight beam |

Career progress, settings, level, best lap, distance and upgrades persist in `localStorage`.

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Throttle |
| `S` / `↓` | Brake / reverse |
| `A` `D` / `←` `→` | Steer |
| `Space` | Handbrake |
| `R` | Recover onto the road |
| `U` | Toggle km/h · mph |
| `M` | Mute audio |
| `Esc` | Pause |
| `Enter` | Start / resume |

## Structure

```
src/game/
  physics.ts      raycast vehicle, gearbox, drag, handbrake
  vehicle.ts      cockpit, wheels and headlights
  cockpit.ts      interior geometry, steering wheel, in-dash screen
  cameraRig.ts    spring lag, tilt, braking pitch, vibration, FOV
  world.ts        road, lamps, signals, gates, city, sky
  route.ts        closed spline, gate distances and placement
  game.ts         loop, run scoring, career persistence, UI bridge
  store.ts        tiny external stores and localStorage
src/ui/           React HUD, title, pause and garage screens
```

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`, which typechecks, builds and
publishes `dist/` to GitHub Pages. The published URL follows the repository name. If the first
run fails because Pages is disabled, set **Settings → Pages → Build and deployment → Source**
to **GitHub Actions** and re-run the workflow.

This repository was rebuilt from an earlier transit-simulator prototype; its contents have been
replaced by Nightshift.
