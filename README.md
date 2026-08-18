# meltcalc

Estimates how much plastic a hotend can melt: sustainable flow rate, residence time, heater power
and cost per mm³/s, across 60 hotends and 36 filament materials.

Live at [meltcalc.baconmilkshake.com](https://meltcalc.baconmilkshake.com).

## The model

Melting a cubic millimetre costs a fixed amount of energy, a melt zone couples only so much power
into the filament per millimetre of heated length, and together those set a ceiling on volumetric
flow. Everything the app shows follows from that.

- **Melt enthalpy** per mm³ for each material: `E = ρ · (cp · ΔT + h_f)`, with `cp` averaged over
  the solid-to-melt interval and `h_f` the heat of fusion, zero for amorphous polymers. `ΔT` runs
  from the temperature the filament actually enters at — chamber or dryer, not room — up to the
  temperature the polymer has to *reach* to extrude: the melting point, or for amorphous polymers
  the lowest temperature at which they flow. The superheat from there to the nozzle setpoint is
  accounted separately, because it costs heater watts without changing the melt zone needed.

- **Sustainable flow rate** per hotend, bounded by `Q = q · L / E` for effective melt zone length
  `L` and specific power `q`. The heater is *not* a second ceiling: a cartridge is the cheap,
  swappable part, so it is assumed sized to the hotend.

- **Heater power** to sustain each hotend at its own maximum, reported as `P = Q · E_setpoint / η`
  at η = 30%, alongside the smallest cartridge from the sizes people actually stock (30, 40, 60,
  70, 80, 100, 120, 240 W). The recommendation is one size past the minimum.

- **Superheat.** Running hotter raises `q`, less than proportionally: it scales as
  `(ΔT_set / ΔT_ref)^n`, with `n` set so doubling a material's normal superheat gives 1.5× the
  flow. Capped at 2×, equal to 1 at the material's own setpoint, and zero at or below the melting
  point.

- **Residence time**: melt zone volume over flow. The few hotends built for 2.85 mm filament hold
  2.7× as much plastic per millimetre and are fed 2.7× slower, so the same melt zone buys them
  proportionally longer.

- **Flow rate** from layer height, line width and print speed (rounded-rectangle extrusion
  profile), or entered directly.

- **Cost per flow**: price over sustainable flow, with the whole database plotted as price against
  what it buys. The background reads either as what a mm³/s costs outright, or as each hotend's
  standing against a regression of flow on log price — that second one is the only view that says
  anything about value rather than price. Unpriced hotends are counted and left off rather than
  ranked at a made-up number.

### Per-hotend build options

A melt zone extender where one fits (+8.5 mm of real heated length), a high-flow (CHT-style) nozzle
where one is available (+8.5 mm of *equivalent* melting capacity — it subdivides the bore rather
than lengthening it, so those hotends are marked on every chart), and the block material where a
hotend ships in more than one. Copper is the reference; aluminium derates flow 20%, brass and steel
30%. A block that cannot hold the material's setpoint is greyed out. Multi-bore blocks — two
designs here, with two and four filament paths — multiply the effective melt zone by their path
count, which is the whole model for them: flow and heater scale, residence time does not.

Neither option is free, and both are charged for in the cost views: an extender adds a flat $9, and
a high-flow nozzle adds whatever `CHT price (USD)` says for that hotend, over the nozzle it already
ships with. On a cheap hotend that can outweigh the flow it buys, which is the point of showing it.

### The one empirical number

There is no clean closed form for conduction into a moving plastic rod, so `q` is calibrated on the
rule of thumb that a standard nozzle running PLA sustains about 1 mm³/s per mm of melt zone. That
works out to about 0.36 W/mm in copper, and every other material scales by the energy it demands to
reach its own melting point. The calibration is editable in the app.

### What it deliberately leaves out

No pressure-drop or melt-viscosity model, so a hotend that can melt a polymer may still fail to
push it. Radial conduction inside the filament is not resolved, and differences in thermal
conductivity between polymers are neglected. Two hotends of equal effective melt zone length are
indistinguishable here.

The material database carries a *practical flow factor* — the share of the ceiling a polymer is
really run at, 0.3 for the superpolymers — shown as a stacked bar in the material views and
deliberately excluded from the flow model. What holds PEEK to 20–40 mm/s is not heat transfer; it
is interlayer bonding against a chamber 200 K below its melting point, crystallisation kinetics,
warping and viscosity. A longer melt zone fixes none of them, so folding that factor into the flow
calculation would make the hotend comparison answer a question it is not measuring.

Materials are compared from their own realistic start temperatures by default, because a shared one
is the misleading option: PEEK comes out of a 150 °C chamber, not a 25 °C room, and charging it for
that first 125 K roughly doubles its apparent melt cost. A switch in the energy view holds
everything at one start temperature when a like-for-like ΔT is what you want.

## Data

`data/hotend data.csv` holds the hotends, `data/materials.csv` the thermal properties. Run
`pnpm data:update-db` after editing either; it regenerates `src/lib/hotend-db.ts` and
`src/lib/material-db.ts`, which are committed. A malformed row is a build failure rather than a
blank screen. See [`data/README.md`](./data/README.md) for what the material numbers mean and how
approximate they are.

Corrections to the data are the most useful contribution. Melt zone lengths in particular are
measured or inferred from drawings, and prices go stale.

## Links

A configuration can be addressed two ways.

`?config=` carries the whole state, compressed by omission: anything equal to its default is left
out, keys are one letter, and hotends are packed into a single run of four-character codes. A link
changing the material and flow rate is about 78 characters; a comparison of every hotend the charts
can colour is about 360. Older link formats still open — see `SHARE_FORMAT_VERSION` in
[`src/lib/config-sharing.ts`](./src/lib/config-sharing.ts). `pnpm share:check` round-trips a set of
configurations and prints their lengths.

`?view=…&hotend=…&material=…` is the readable form, for links written by hand rather than by the
share button. It covers less — no per-hotend build options — but every value is a name from the
databases. [`/llms.txt`](https://meltcalc.baconmilkshake.com/llms.txt) publishes the grammar and
every hotend, material and view slug, generated from the same databases so it cannot go stale.

Both forms render the same page and unfurl with a chart image drawn server-side.

Either one also answers in markdown. A request sending `Accept: text/markdown` gets that link's
results as text — the same model the chart and the meta tags are built from, rendered as tables
instead of an app shell to execute. HTML stays the default, a wildcard `Accept` does not switch it,
and both representations send `Vary: Accept`. Responses carry `x-markdown-tokens` so a caller can
budget context before reading the body.

## Contribute

0. Install Node.js v24, then corepack (`npm i -g corepack@latest`, `corepack enable`)
1. Fork and clone the repository
2. Install the dependencies

    ```sh
    pnpm install
    ```



4. Edit CSV files in ./data with additional columns for new hotends or materials you would like to add, the fields are fairly
self-explanatory. The convention for melt zone length is that it is measured from the top of hot part of the heatbreak or block
to the tip of the nozzle.

5. Write the updated data to the database
    ```sh
    pnpm data:update-db
    ```

6. Run the development server

    ```sh
    pnpm dev
    ```

`pnpm dev` serves the app and the OpenGraph endpoints together, so `/og.png?config=…` and the
per-link `<head>` tags behave as they do in production.

`pnpm build` produces the SPA in `dist/public`, its shell in `dist/template` and a Nitro server in
`.output`; `pnpm preview` runs the built server. `pnpm lint` is Biome; formatting is Prettier via
`pnpm format`.

You can also open an issue on github with the information for a hotend or material you wish to add (see raw data that is needed 
in the CSV files in ./data.


## Layout

| Path              | What lives there                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `src/lib`         | The physics (`thermal.ts`), the databases and the configuration shape. No browser APIs     |
| `src/state`       | Jotai atoms: the `localStorage` layer, the shared-link override, and the derived analysis  |
| `src/components`  | The app's own components; `src/components/ui` is shadcn/ui                                 |
| `server`          | Nitro app: per-request OpenGraph tags, `/og.png`, `/llms.txt`, `robots.txt`, the sitemap   |
| `scripts`, `data` | Build steps and the CSV to TypeScript data generator                                       |

The server exists only so crawlers and agents get per-link tags, a rendered card and a body they can
read without running JavaScript — the app itself is a static SPA. Both halves import the same
`src/lib/thermal.ts`, so an unfurled link can never report different numbers from the page it opens.

## License

This project is licensed under the [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) license.
