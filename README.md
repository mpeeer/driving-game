# Railbound — Transit Simulator

An in-depth, fully procedural train simulator that runs in the browser. Drive metro, light rail,
regional, heavy-rail and high-speed services across a growing network, manage the timetable, and
build a career out of fares, punctuality and route rights.

Everything is generated at runtime: the alignments, stations, scenery, train bodies, cab interiors,
passengers and the soundtrack. There are no downloaded models, textures or audio files.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL. `npm run build` produces a static bundle in `dist/`.

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
- **Full UI** — route strip, speedometer, power/brake notches, service clock and delay, next-stop
  guidance, dispatch board with route maps, depot and results screens, settings and persistence.

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
