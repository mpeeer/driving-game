# Railbound — Transit Simulator

An in-depth, fully procedural train simulator that runs in the browser. Drive metro, light rail,
regional, heavy-rail and high-speed services across a growing network, manage the timetable, and
build a career out of fares, punctuality and route rights.

Everything in the simulation is generated at runtime: the alignments, stations, scenery, train
bodies, cab interiors, passengers and soundtrack. There are no downloaded models, textures or audio
files. The interface is a React 19 overlay on Tailwind CSS v4 and shadcn/Base UI; its two typefaces
are loaded from Google Fonts.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL. `npm run build` produces a static bundle in `dist/`.

## UI architecture

The simulation remains framework-free TypeScript and Three.js. `src/ui/hud.tsx` is the facade the
engine talks to; it writes presentation state into the typed store in `src/ui/store.ts`. React
screens under `src/ui/screens/` subscribe to narrow `useUiStore` selectors, so driving HUD updates
never re-render the menu or dispatch board. Shared rail-signal primitives live in
`src/ui/components/`; generated shadcn/Base UI components live in `src/components/ui/`.

## Play online

The latest build is live at <https://mpeeer.github.io/train-sim-/>.

Every push to `main` runs `.github/workflows/deploy.yml`, which typechecks, builds and publishes
`dist/` to GitHub Pages. If the first deployment fails because Pages is disabled, set
**Settings → Pages → Build and deployment → Source** to **GitHub Actions** and re-run the workflow.

## What is in the game

- **Driving simulation** — tractive-effort and power limits, adhesion (with wet-rail slip), Davis
  rolling resistance, gradient forces, air-brake application and release lag, door interlock,
  regenerative energy accounting and overspeed protection.
- **Real cabs and views** — a modelled first-person cab with live screens, animated levers, wipers
  and a working windscreen; chase and orbit cameras with mouse look, zoom and suspension motion.
- **Railway world** — procedurally generated alignments with curvature and gradient limits,
  double track, ballast, sleepers, catenary, signals, speed boards, buffer stops, platforms,
  canopies, footbridges and station signage. Five distinct regions, from harbour city to alpine pass.
- **Passengers** — platform crowds that idle, wander, cluster at doors, board and alight, with
  crowding and comfort affecting satisfaction and fares.
- **Economy and career** — fares, punctuality bonuses, stopping accuracy, penalties, energy,
  maintenance and crew costs. Buy route rights, rolling stock and depot upgrades. Experience and
  levels gate new content.
- **Endless network** — every region generates additional lines as your level rises, each with its
  own alignment, demand and fare multiplier.
- **Living atmosphere** — time-of-day lighting, sun/shadow direction, station lights, rain and
  wet-rail adhesion, procedural traction-motor whine, rail-joint clacks, brake squeal, air hiss,
  horn, door chimes and speech-synthesised station announcements.
- **Full UI** — a transit-control interface across the departure-board menu, dispatch map, depot,
  driver console, pause settings and service report. It includes a route spine, next-stop board,
  limit sign, load meter, speedometer, power/brake notches, responsive layouts, keyboard focus and
  reduced-motion support.

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Increase power |
| `S` / `↓` | Increase brake |
| `Z` | Throttle to coast |
| `X` | Release brake |
| `E` | Emergency brake |
| `D` | Open / close doors |
| `Space` | Horn |
| `H` | Headlights (off / dipped / full) |
| `F` | Wipers |
| `R` | Change reverser (when stopped) |
| `C` | Cycle camera (cab / chase / orbit) |
| Mouse drag | Look around |
| Mouse wheel | Zoom camera |
| `Esc` | Pause |

## How a service works

Close the doors, take power and run to the next station. Brake early: the platform speed limit and
the stop board are the two things that decide your score. Stop with the cab at the stop board, close
the doors after the exchange, and repeat. Punctuality and precise stops pay; hard braking, overspeed
and missed platforms cost money and passenger satisfaction. At the terminus close the doors to
complete the service and see the receipt.

Progress is saved locally in the browser.
