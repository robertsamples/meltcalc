# meltcalc

I assembled a spreadsheet and some models for predicting flow for different materials and hotend
combinations so I could compare hotends and material flow predictions accurately. But I thought it
might be useful for others, so I made a website for different visualizations for hotend and material
comparisons.

I found most manufacturers tend to give wildly optimistic flow measurements for their hotends. Most
of the calculators for max print speed for different hotends just seem to take manufacturer
advertising numbers, or pluck them out of thin air.

Live at [meltcalc.baconmilkshake.com](https://meltcalc.baconmilkshake.com).

## Features

79 hotends and 36 different base polymers for comparisons.

Max volumetric flow rate and print speed estimations with support for CHT/HF modifiers, different
block types, and print temperatures.

Heater power requirement estimations.

Hotend price/performance calculations, including the price of the extender or high flow nozzle when
you tick those options.

Hotend comparisons for total power that needs to be dissipated on the melt surface, and how long
filament spends in the melt zone for a given flow rate.

Comparisons of estimated max flow rate and melt energy for different materials with a given hotend.
This is basically melt index, which is very useful but is sadly not used for head to head material
comparisons with a particular hotend very often.

## How it works

A full description of the model and the design notes behind it is in [theory.md](theory.md).
What follows is the short version.

Melting a cubic millimetre costs a fixed amount of energy, and a melt zone can only couple so much
power into the filament per millimetre of heated length. Those two facts set a ceiling on volumetric
flow, and everything on the site follows from it.

**Melt energy.** `E = ρ (cp ΔT + h_f)` per mm³, with `cp` averaged over the solid to melt interval
and `h_f` the heat of fusion, which is zero for amorphous polymers. `ΔT` runs from the temperature
the filament actually enters at, so a chamber or dryer rather than room temperature, up to the
temperature the polymer has to reach to extrude. That is the melting point, or for amorphous
polymers the lowest temperature at which they flow. The superheat from there up to the nozzle
setpoint is counted separately, because it costs heater watts without changing the melt zone you
need.

**Flow ceiling.** `Q = q L / E`, where `L` is the effective melt zone length and `q` is the power a
millimetre of melt zone couples into the filament. There is no clean closed form for `q`, so it is
calibrated on a standard nozzle running PLA sustaining 1.2 mm³/s per mm of melt zone. That works out
to about 0.43 W/mm in copper, and every other material scales by the energy it demands to reach its
own melting point. The calibration is editable on the site if your measurements disagree.

**Effective melt zone.** The database holds two lengths per hotend. One is the physical heated
channel of a single bore, which is the number that describes the hardware. The other is what the
model runs on, and it is entered by hand wherever a hotend does not behave like its dimensions: a
multi bore block carries the total across all its bores, and a hotend with high flow geometry built
into it carries what that geometry is worth rather than what it measures.

From there the model takes off 3.5 mm for the nozzle taper. Measured back from the tip that lands
about halfway along the hex of a V6 nozzle, which is roughly where the bore starts narrowing to the
orifice. Past that point there is little wall left against the filament and the pressure behaviour
stops helping, so the length is there without melting much. It is a fixed deduction rather than a
percentage because the taper is the same size whatever the block behind it is, and it is what brings
long melt zones back in line, since they read optimistic against measurements otherwise.

**Build options.** An extender adds 8.5 mm of real heated length, so it counts against both figures.
A CHT style nozzle adds no length but splits the bore into parallel channels, so the plastic meets
more hot wall per millimetre. That buys roughly the same melting capacity, so the model counts it as
an equivalent 8.5 mm against the effective figure only, and marks those hotends on the charts.
Copper is the reference block; aluminium gives up 20% of the flow, brass and steel 30%.

**Superheat.** Running hotter raises `q`, but less than proportionally. It scales as
`(ΔT_set / ΔT_ref)^n`, with `n` picked so that doubling a material's normal superheat gives 1.5x the
flow. It caps at 2x, sits at 1 when you are at the material's own setpoint, and drops to zero at the
melting point.

**Heater power.** Reported as `P = Q E_setpoint / η` at 30% efficiency, next to the smallest
cartridge from the sizes people actually stock. Heater power is not treated as a second ceiling on
flow, because a cartridge is the cheap swappable part and nobody is stuck with an undersized one.

**Residence time.** Melt zone volume over flow. The few hotends built for 2.85 mm filament hold 2.7x
as much plastic per millimetre and are fed 2.7x slower, so the same melt zone gives them
proportionally longer. On a multi bore block the flow and the volume both carry the bore count, so
what comes out is the time one path sees rather than the whole hotend.

## Obligatory notes

The backend models are all my own work and are based on first principles: melt zone length, specific
heat capacity, heat of fusion, and some approximations for the effects of CHT nozzles and material
selection for heat blocks.

For the frontend UI and graphs, the TypeScript and CSS was written with AI assistance if that
matters to you.

There are a ton of caveats about heater placement and block geometry that this doesn't represent, so
it can lead to flow being underestimated for some high performance hotends (Chube and Tricorn). I
chose to go with the same base model for all hotends rather than bias results with a ton of
correction factors.

I have not added any provision for the effects of nozzle diameter, though I would like to in the
future. For higher flow rate hotends, larger nozzle diameters are almost certainly going to be
needed.

There is no pressure drop or melt viscosity model, so a hotend that can melt a polymer may still
fail to push it. Material properties are typical published values rather than brand specific
measurements.

The material database also carries a practical flow factor, which is the share of the ceiling a
polymer actually gets run at. It is shown as a stacked bar in the material views and is deliberately
left out of the flow model. What holds PEEK to 20-40 mm/s is not heat transfer, it is interlayer
bonding against a chamber well below its melting point, crystallisation, warping and viscosity. A
longer melt zone fixes none of that, so folding it into the flow number would make the hotend
comparison answer a question it isn't measuring.

## Validation

The model is checked against published max flow tests at
[meltcalc.baconmilkshake.com/validation](https://meltcalc.baconmilkshake.com/validation). As it
stands that is 70 tests from 4 sources: the centre sits at 1.01x measured over predicted, R2 is
0.76, and about half the tests land within 25% of the prediction.

The per term results matter more than the overall number. The CHT credit measures 1.59x against the
1.53x modelled, which is close. The temperature term comes out softer than modelled, an exponent
near 0.50 against 0.58. Nozzle diameter still has no term in the model and stock nozzles do not
appear to need one, but CHT nozzles gain with diameter in a way the model does not capture.

More data would help, so if you have run a max flow test I would like it. Open an issue with:

- extruder
- hotend, and whether the nozzle is CHT/HF or a regular one
- nozzle diameter
- filament type and brand
- the max flow rate you measured

If you ran an Orca flow or temperature tower, the most useful pair of numbers is the rough flow
where the surface first goes matte or starts looking slightly underextruded, and the flow where it
obviously fails. Either one on its own is fine.

## Data

The project is open source, so if you want to contribute more hotends or materials that aren't
already on the site, that is the most useful thing you can add.

`data/hotend data.csv` holds the hotends and `data/materials.csv` holds the thermal properties. The
convention for melt zone length is that it is measured from the top of the hot part of the heatbreak
or block down to the tip of the nozzle. Run `pnpm data:update-db` after editing either file, which
regenerates `src/lib/hotend-db.ts` and `src/lib/material-db.ts`. Both generated files are committed.
A malformed row is a build failure rather than a blank page.

See [`data/README.md`](./data/README.md) for what the material numbers mean and how approximate they
are. Prices go stale and melt zone lengths are measured or inferred from drawings, so corrections to
either are welcome.

## Running it locally

Install Node.js v24 and corepack:

```sh
npm i -g corepack@latest
corepack enable
```

Fork and clone the repository, then install the dependencies:

```sh
pnpm install
```

Run the development server:

```sh
pnpm dev
```

If you edited the CSVs, write them to the database first:

```sh
pnpm data:update-db
```

`pnpm build` produces the site and a small server that renders the link previews, and `pnpm preview`
runs the built version.

## License

This project is licensed under the
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) license.
