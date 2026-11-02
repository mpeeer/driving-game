# Coastline — Open Island Driving

A lightweight first-person and chase-camera driving game set on one continuous **9.1 km**
island loop. Pick a district, settle into the cockpit or drop back behind the car and drive
the expanded coast road, the alpine pass, the vine valley or the harbor city, with dense
two-way traffic and a full day-to-night cycle.

The world now includes a long suspension bridge over a coastal bay, a wide beach shelf with
umbrellas and a lifeguard tower, a four-lane highway, and a fully driveable junction district:
the Seaview roundabout and the elevated Skyway interchange both have real entry and exit slip
roads cut through the guardrail, with raised surfaces the car actually climbs.

The island, terrain, traffic, sky and cockpit are generated at runtime. The only imported
assets are the three selectable player-car bodies in `public/models/`; everything else is
built in code.

Built with Three.js, [cannon-es](https://github.com/pmndrs/cannon-es) `RaycastVehicle`,
React 19, Tailwind CSS v4 and Vite.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL. `npm run build` typechecks and emits a static bundle in `dist/`.

## The island

- **Golden Coast** — a wider sand beach, sea cliffs, palms, a suspension bridge and the long
  sunset straight.
- **Alpine Pass** — cool pine slopes, rock outcrops and a climbing, descending shelf road.
- **Vine Valley** — warm fields, cypress, fast open bends and rolling rises.
- **Harbor City** — a waterfront grid of towers, an overpass and neon signage.

Four districts sit on one loop, so you can start anywhere and drive the whole island without
a loading screen. The coast, pass, valley and city are linked by real elevation changes. The
car's centre-console GPS shows the island loop and both junction roads, with the interchange
called out at the coast.

The highway remains the main loop, but the two junction roads are now part of the driveable
surface graph. Their centerlines, height profiles and merge geometry are shared with the car
controller, so the roundabout ring and the elevated skyway can be entered, driven and exited.
Selected highway traffic can also choose the skyway bypass or the roundabout detour and merge
back onto the main road.

## Cars

The garage swaps the chase-view bodywork. All three bodies are fitted to the same physics
footprint and are loaded on demand, then cached for the session:

- **Chevrolet Camaro SS** — the light default, built from the supplied low-poly OBJ/MTL pair.
- **Koenigsegg** — the high-detail FBX body, with its stray export triangles removed, its
  four wheels re-rigged for steering and roll, and a graphite paint/clear-coat profile that
  keeps the near-black carbon export readable at day and night. The archive's duplicate OBJ
  is not shipped; only the FBX is loaded.
- **Mercedes-Benz GLS 580** — the high-detail FBX body, with its 329 export material runs
  consolidated down to 23 draw calls.

The choice is saved with the rest of the settings. The first-person camera keeps the
hand-built cockpit interior; the selected body appears when you switch to chase view with
`C`. If a body cannot load, the workshop car remains available and the drive continues.

The supplied bodies are excluded from the project's MIT licence; confirm you have the right
to redistribute them before publishing this build.

## Driving

- A forgiving `RaycastVehicle` setup: progressive grip, gentle speed-sensitive steering,
  downforce, a soft handbrake and a six-speed automatic.
- Two cameras: a left-hand-drive cockpit with a raised, slim roof, laminated framed glass,
  chrome-ringed analogue dials, a physical climate panel, mirrors and a leather wheel, plus a
  smooth exterior chase view with the selected car body and a compact speed readout.
- **Sixty-four** low-poly highway cars plus dedicated junction traffic, including slower
  vans, run across four marked lanes. Selected cars choose the Skyway bypass or the roundabout
  detour and merge back onto the main road; the rest keep the highway populated around the
  player. Traffic brakes for cars ahead and for your car, and collisions scrub speed instead
  of passing through.
- **Interchange Trial** — a timed run from the bridge approach through the skyway and around
  the roundabout. The HUD tracks the next objective; the best time is saved and shown on the
  title screen, with credits and XP for a clean finish.
- A five-minute day cycle rolls from late afternoon into sunset, a 2,200-star night and back
  around. The sun, moon, sky palette, fog, water tint and city windows all change together.
  Traffic headlights and the player's headlights come on automatically; a local cabin light
  keeps the instruments readable after dark.
- Very rare night-time shooting stars cross the sky during the driving cycle.
- Twelve sector gates pay credits and XP. Clean gate runs add a bonus; a full lap records a
  best time. Credits buy engine, tyre, brake and aero stages in the garage.
- Career progress, settings, selected car, best lap, distance and upgrades persist in `localStorage`.

## Performance

The graphics target is bright, readable and low-cost rather than photoreal:

- Lambert/Phong materials, vertex-coloured terrain and instanced vegetation.
- Merged traffic-car meshes so four lanes of AI traffic stay inexpensive.
- No shadow maps, no PBR environment probe and no post-processing.
- One flat water plane, one terrain mesh and lightweight distant ridges.
- A shader sky dome, one point-cloud star field and a handful of cloud sprites replace the
  baked sky; the sun, moon, fog and lights all follow the same time-of-day state.
- Adaptive render resolution plus low/medium/high quality presets; medium is the default.
- Car bodies are fetched only when selected and stay cached. The Camaro and Koenigsegg are
  light meshes; the GLS is reserved for players who want the extra detail.
- Barlow Condensed and IBM Plex are bundled locally and loaded before the first render.

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Throttle |
| `S` / `↓` | Brake / reverse |
| `A` `D` / `←` `→` | Steer |
| `Space` | Handbrake |
| `R` | Recover onto the nearest highway or junction road |
| `C` | Toggle cockpit / chase camera |
| `U` | Toggle km/h · mph |
| `M` | Mute audio |
| `Esc` | Pause |
| `Enter` | Start / resume |

## Structure

```
src/game/
  physics.ts      raycast vehicle, gearbox, grip, drag and handbrake
  carModels.ts    supplied-body loading, cleanup, fitting and material tuning
  vehicle.ts      exterior body, wheels, cockpit visibility and transform sync
  cockpit.ts      cabin, wheel, hands and instrument canvases
  cameraRig.ts    cockpit and chase cameras, smooth follow, shake and FOV
  world.ts        scaled island, bridge, beach, interchange, roundabout, city and gates
  atmosphere.ts   sky shader, sun/moon, stars, rare meteors, clouds and lighting
  traffic.ts      four-lane two-way traffic, following and player collisions
  route.ts        closed island spline, elevation profile and district placement
  roads.ts        shared driveable roundabout/skyway surface graph and AI detour paths
  game.ts         loop, traffic, score, region starts and persistence
  store.ts        external stores and localStorage
src/ui/           React title, HUD, pause, garage and SVG map
src/fonts/        bundled OFL font files and licences
public/models/    Camaro OBJ/MTL, Koenigsegg FBX and Mercedes GLS FBX
```

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`, which typechecks, builds and
publishes `dist/` to GitHub Pages at <https://mpeeer.github.io/driving-game/>.
