# Railbound UI Rework Implementation Plan

> **For agentic workers:** Execute task-by-task from this plan. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is being executed in the same session that authored it; the user has authorized the rework.

**Goal:** Replace the monolithic imperative HUD with a distinctive, accessible, maintainable transit-control interface built on React, Tailwind CSS v4 and shadcn/ui, without changing the simulation.

**Architecture:** Keep `Game`, `Session`, `Economy` and Three.js rendering as the domain core. Put a thin `Hud` facade in front of a typed external store, so the engine keeps its current API. React screens subscribe to narrow slices of the store; pure view helpers derive route lists, unlock states and map geometry from the existing content/economy modules.

**Tech Stack:** TypeScript 5.6, Vite 5, Three.js 0.169, React 19, Tailwind CSS v4, shadcn/ui (Base UI), Sonner, Lucide icons.

**Spec:** This document is the design and implementation spec.

## Global Constraints

- Do not alter train physics, route generation, economy rules or save data.
- Preserve the public API used by `src/core/game.ts`: `showScreen`, `renderMenu`, `renderDispatch`, `renderDepot`, `setupSession`, `update`, `setLoading`, `toast`, `showStopToast`, `showSummary`, `renderPauseSettings`, `selectedLineId`, `selectedRegion`, `depotTab`.
- Keep the Vite build base `./` for GitHub Pages project hosting.
- All UI copy and controls must work with keyboard and screen readers; respect `prefers-reduced-motion`.
- No external image assets. The 3D scene remains the visual backdrop.
- Typecheck and production build must pass before commit.

## Review Focus

- HUD updates arrive every ~55 ms while driving: screen selection must not re-render the menu or dispatch board unnecessarily.
- Long routes and generated lines can contain many stations: the route strip must scroll and keep the current stop visible.
- A locked region or line must never present an enabled start control.
- Dialogs/pause must not swallow driving keys or leave focus trapped after closing.
- The interface must remain legible over both bright sky and dark night scenes.

---

### Task 1: Toolchain and design tokens

**Files:**
- Modify: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`
- Replace: `src/styles.css`
- Create: `components.json`, `src/ui/lib/utils.ts`

- [ ] Install React, Tailwind v4, shadcn dependencies.
- [ ] Enable the React and Tailwind Vite plugins and the `@/` alias.
- [ ] Initialize shadcn and add Button, Card, Badge, Progress, Separator, Tabs, Dialog, AlertDialog, Switch, Slider, Select, Sonner.
- [ ] Define a rail-signal design system: ink/steel/paper palette, amber/teal signal accents, condensed display type, mono data type, 2px structural radii.
- [ ] Verify `npm run typecheck`.

### Task 2: Typed UI state boundary

**Files:**
- Create: `src/ui/store.ts`, `src/ui/types.ts`, `src/ui/lib/derive.ts`, `src/ui/lib/format.ts`
- Replace: `src/ui/hud.ts` with `src/ui/hud.tsx`

- [ ] Define `UiState`, `ScreenName`, `DepotTab`, `SummaryView`, `UiActions` as a small typed vocabulary.
- [ ] Implement `UiStore` with immutable patches and `useUiStore` backed by `useSyncExternalStore`.
- [ ] Implement the `Hud` facade mapping the existing engine calls onto store patches.
- [ ] Move formatting and line/region derivation into pure helpers.

### Task 3: Shared visual components

**Files:**
- Create: `src/ui/components/brand.tsx`, `line-badge.tsx`, `line-map.tsx`, `speed-gauge.tsx`, `toasts.tsx`, `screen-shell.tsx`

- [ ] Build the wordmark, line badges, route map canvas, speedometer and station toast.
- [ ] Use shadcn primitives for buttons, badges, progress, dialogs and controls.
- [ ] Add visible focus styles, reduced-motion handling and responsive rules.

### Task 4: Menu and service screens

**Files:**
- Create: `src/ui/screens/menu-screen.tsx`, `dispatch-screen.tsx`, `depot-screen.tsx`, `controls-dialog.tsx`

- [ ] Rebuild the menu as a late-evening departure board, with career status and a single clear entry action.
- [ ] Rebuild dispatch with region tabs, line roster, generated route map, station list, train picker and unlock states.
- [ ] Rebuild the depot as network rights, rolling stock and upgrade tabs.
- [ ] Use shadcn AlertDialog for the destructive career reset.

### Task 5: Driving console and overlays

**Files:**
- Create: `src/ui/screens/driving-hud.tsx`, `pause-dialog.tsx`, `summary-dialog.tsx`, `src/ui/RailboundUI.tsx`

- [ ] Rebuild the HUD top bar, route strip, next-stop board, limit sign, load meter, gauge and action console.
- [ ] Rebuild pause settings with shadcn Slider, Switch and Select.
- [ ] Rebuild the service summary as a readable operations report.
- [ ] Mount all screens through a narrow selector-based root.

### Task 6: Verification and deployment

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Start Vite, inspect the live app at desktop and mobile sizes, and capture screenshots if a browser is available.
- [ ] Check that the production bundle still loads under `/train-sim-/`.
- [ ] Commit the rework with attribution and push to `main` so GitHub Pages redeploys.
