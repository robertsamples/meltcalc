# meltcalc

Hotend and polymer melt index tool: how much plastic a given melt zone can actually melt, how long
the filament spends inside it, and what that costs in energy.

## What it calculates

- **Flow rate** from layer height, line width and print speed (rounded-rectangle extrusion profile),
  or entered directly.
- **Residence time** per hotend: melt zone volume divided by flow, for 1.75 mm filament.
- **Melt energy** per mm³ for each material: `ρ · (cp · ΔT + h_f)`, split at the melting point into
  the climb from the filament's start temperature (chamber or dryer), the crystalline melt
  enthalpy, and the superheat up to the nozzle setpoint. Optionally scaled to watts at the current
  flow rate.
- **Sustainable flow rate** per hotend, from two independent ceilings: the melt zone's ability to
  bring the plastic to its **melting point**, and the heater's ability to supply the whole
  enthalpy up to the **setpoint**. Running a nozzle hotter therefore raises the wattage without
  changing the melt zone a hotend needs.
- **Per-hotend build options**: a melt zone extender where one fits (+8.5 mm), a high-flow
  (CHT-style) nozzle where one is available (+8.5 mm of *equivalent* melting capacity rather than
  real length, so those hotends are asterisked on every chart), and the block material where a
  hotend ships in more than one (copper is the reference; brass and steel derate flow 30%,
  aluminium 20%). A block that cannot hold the material's setpoint is greyed out in the picker.

The melt zone ceiling is the one empirical part of the model. There is no clean closed form for
conduction into a moving plastic rod, so it is calibrated on the rule of thumb that a standard
nozzle running PLA sustains about 1 mm³/s per mm of melt zone. That is converted to W/mm — about
0.36 on the melt basis — and every other material is scaled by how much energy it demands to reach
its own melting point. The calibration is editable in the app.

Materials are compared from their own realistic start temperatures by default, because a shared
one is the misleading option: PEEK comes out of a 150 °C chamber, not a 25 °C room, and charging it
for that first 125 K roughly doubles its apparent melt cost. A switch in the energy view holds
everything at one start temperature when a like-for-like ΔT is what you actually want.

## Data

`data/hotend data.csv` holds the melt zone lengths, `data/materials.csv` the thermal properties.
Run `pnpm data:update-db` after editing either; it regenerates `src/lib/hotend-db.ts` and
`src/lib/material-db.ts`, which are committed. See [`data/README.md`](./data/README.md) for what the
material numbers mean and how approximate they are.

## Contribute

0. Install Node.js v24, install corepack (`npm i -g corepack@latest`, `corepack enable`)
1. Fork the repository
2. Clone the repository
3. Install the dependencies

    ```sh
    pnpm install
    ```

4. Run the development server

    ```sh
    pnpm dev
    ```

`pnpm dev` serves the app and the OpenGraph endpoints together, so `/og.png?config=…` and the
per-link `<head>` tags work the same as in production.

`pnpm build` produces the SPA in `dist/public`, its shell in `dist/template` and a Nitro server in
`.output`; `pnpm preview` runs the built server.

## Layout

| Path             | What lives there                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `src/lib`        | The physics (`thermal.ts`), the databases and the configuration shape. No browser APIs     |
| `src/state`      | Jotai atoms: the `localStorage` layer, the shared-link override, and the derived analysis  |
| `src/components` | The app's own components; `src/components/ui` is shadcn/ui                                 |
| `server`         | Nitro app: per-request OpenGraph tags and the rendered `/og.png`                           |
| `scripts`, `data`| Build steps and the CSV → TypeScript data generator                                        |

The server exists only so crawlers get per-link OpenGraph tags and a rendered card — the app itself
is a static SPA. Both halves import the same `src/lib/thermal.ts`, so an unfurled link can never
report different numbers from the page it opens.

## License

This project is licensed under the [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) license.
