# Data sources

Both CSVs here are the source of truth. `pnpm data:update-db` regenerates `src/lib/hotend-db.ts` and
`src/lib/material-db.ts` from them; the generated files are committed so the app has no build-time
data step.

## `hotend data.csv`

Melt zone lengths in millimetres, measured/collected per hotend. The melt zone is the heated length
the filament travels through, which is what sets both residence time and how much power can be
coupled into the plastic.

- **MZE compatible** is `Y`/`N`: whether a melt zone extender fits. Fitting one adds 8.5 mm of
  heated length, which the app offers as a per-hotend checkbox. The v6 pro extender is deliberately
  not modelled.
- **HF nozzle compatible** is `Y`/`N`: whether a high-flow (CHT-style) nozzle is available. Fitting
  one adds another 8.5 mm — not of real channel, but of equivalent melting capacity, since the
  parallel bores put far more hot wall against the plastic. Everything the app shows is therefore
  an *effective* melt zone, and hotends fitted with one are marked with an asterisk because their
  physical heated length is shorter than the number plotted.
- **Block Material** and **Max temp** are slash-separated lists paired positionally, stock option
  first: `Cu/Al` with `500/300` is a copper block rated to 500 °C and an aluminium one rated to
  300 °C. `Cu` = copper, `Br` = brass, `Al` = aluminium, `St` = steel. Brass and steel give up 30%
  of the flow a copper block of the same length sustains and aluminium 20%; copper is the reference
  the calibration is expressed in. A hotend whose block cannot hold the material's print
  temperature is greyed out in the picker.

- **Price (USD)** is an approximate street price, and it is the one column that may be **left
  blank**. Blank means nobody has found a price: the hotend shows a dash in the table, is left out
  of the cost ranking, and is counted underneath the chart rather than plotted. That is deliberate —
  an unknown price is not a low one, and any stand-in number would put it straight to the top of a
  chart whose whole job is ranking by price. Fill the cell in and it joins the comparison.

`hotend deltas.csv` records how much melt zone a given modification adds (a longer heatbreak, a
volcano block). It is reference material for deriving new rows by hand; only the MZE delta is used
by the app.

## `materials.csv`

Typical published values for FDM filaments, one row per base polymer. Filled grades are not split
out: a carbon-filled nylon is a nylon, and the filler moves these numbers by less than the spread
between brands does.

**Family** groups them chemically and is what tints the material names in the energy chart, so its
values have to come from the fixed list in `src/lib/material.ts` — the order there is what assigns
each family its colour.

They are approximations, and every one of them moves with brand, filler loading and thermal
history:

- **Density** is the solid-state value. Melt density is 5-10% lower; using the solid value is the
  convention for "energy per mm³ of extruded plastic" because a mm³ of print is a mm³ of solid.
- **Specific heat capacity** is a single average across the whole solid → melt span. Real cp climbs
  with temperature (PLA is roughly 1.2 J/g·K cold and 2.1 J/g·K molten), so one averaged number is
  the right shape of approximation for this calculation.
- **Heat of fusion** is the enthalpy actually paid at the melting point, i.e. the fully crystalline
  value scaled by the crystallinity a printed part reaches. Amorphous polymers (PETG, ABS, PC, PEI)
  are `0`: there is no crystal lattice to break down, which is why they melt so cheaply.
- **Melt temp** is the temperature the plastic has to *reach* to be extrudable, and it is what the
  melt zone is sized against. For semi-crystalline polymers it is the crystalline melting point
  (Tm). Amorphous polymers have no Tm, so it is the lowest temperature they flow well enough to
  extrude — roughly Tg + 100 K, and the per-material reasoning is in the Notes column.
- **Print temp** is a mid-range nozzle setpoint for the material, not a recommendation for any one
  brand. It sits above the melt temp; the difference is superheat, which the heater supplies but
  the melt zone is not sized for.
- **Start temp** is the temperature the filament enters the hotend at — ambient for open printers,
  chamber or dryer temperature for the materials that need one. It matters more than it looks:
  PEEK entering at 150 °C rather than 25 °C is a third off its melt energy, and comparing it
  against a room-temperature filament without accounting for that is the single easiest way to
  make a high-temp material look worse than it is.
