# Theory

A technical discussion of the model behind [MeltCalc](https://meltcalc.baconmilkshake.com).

The in-app *How this works* card is the short version and is generated from the constants it describes. This document is a full discussion of the methodology, including derivations, the reasoning behind each approximation, limitations of the approach, and ideas for further refinement.

Constants are quoted with their values as of writing, as given by `src/lib/thermal.ts` for the thermodynamics and `src/lib/hotend.ts` for the geometry allowances.

---

## 1. Model definition and premise

The goal of this tool is to model hotend and material behaviour as accurately as possible using a minimal set of easily accessible factors (e.g. no polymer specific rheology numbers or fine geometric factors). This analysis only considers value on the basis of efficient thermopolymer melting and leaves out many incidental factors that customers typically find valuable, such as being well sealed against leaks, surviving abrasive filament, and holding tolerance at 500 °C. The model purposefully neglects difficult to control factors such as the extrusion system, and presumes a suitably powerful extruder congruent with the common systems that the reference observations were performed with.

The model thus reduces to a requested target and a capability, each built from a different group of factors:

$$
\text{print settings} \;\rightarrow\; Q_\text{target}
\qquad
\text{hotend} + \text{material} \;\rightarrow\; Q_\text{max}
$$

and the comparison is $Q_\text{max}$ against $Q_\text{target}$. The majority of the model rests on one empirical constant. Everything else is either a textbook property of the polymer or a geometric bookkeeping decision about what counts as melt zone.

This is intrinsically a very reductive approach relative to most models in the academic literature or real FEA analysis. However, this is an intentional and inevitable limitation given the limited data available and the intended general application of this tool. The primary goals are to provide a uniform comparison of hotends without marketing copy layered on top, and to provide approximate directional and magnitude comparisons between different hotends and different filaments, so that a consumer has more complete information to answer the questions "is hotend B worth \$20 more to me than hotend A?" and "if I switch my purchasing decisions from PETG to ABS filament, how much faster roughly will I be able to print?"

A model with six fitted parameters can reproduce any set of measurements, but is not tractable for these goals given that precise geometry is not available for many hotends, detailed rheological constants are not available for almost any consumer FDM filament, and extrusion force is typically not measured by consumers.

Given this, the ordinal comparisons are likely of higher confidence than the precise nominal values, though I do find that the model outputs match experimental flow rates quite well.

A final note: there is a fairly large range of what one might call the *failure point* in terms of maximum volumetric flow rate. Typically weakening layer adhesion and matting of the wall surface finish occur first, followed by underextrusion, and then frank failure of test object geometry (in the case of a max flow tower). I typically define the maximum flow rate at the point where surface matting becomes apparent.

---

## 2. Melt enthalpy

Energy per unit volume of extrudate:

```math
E = \rho \left( c_p \, \Delta T + h_f \right)
```

with $\rho$ the **solid** density, $c_p$ the specific heat capacity averaged over the interval, and $h_f$ the heat of fusion.

**Why solid density.** A cubic millimetre of finished print (and filament) is a cubic millimetre of solid. Melt density is lower, but the extrudate is specified by what it becomes, not by what it was while passing through the nozzle. Using melt density would understate the energy by roughly the thermal expansion, and would make the model's output disagree with the flow rate a slicer reports.

**Why $h_f$ at all.** For crystalline and semi-crystalline materials it is not a rounding error. For polyethylene it is comparable to the entire sensible-heat term, which is why HDPE is cheap to warm and expensive to melt; for polycarbonate it is zero and the whole cost is sensible heat. A model that dropped fusion would rank the two backwards.

For amorphous polymers $h_f = 0$: there is no crystal lattice to dissociate, only a glass transition that requires nothing beyond $c_p$. The database records fusion enthalpies already scaled by typical crystallinity, not the fully-crystalline textbook values. Consumer spools for printing are typically low crystallinity, given the very rapid cooling that occurs in a filament extrusion line.

### 2.1 The split at the melting point

$E$ is split in two, and the split is the single most consequential modelling decision:

```math
E_\text{melt} = \rho\left(c_p (T_m - T_0) + h_f\right)
\qquad
E_\text{set} = E_\text{melt} + \rho\, c_p (T_\text{set} - T_m)
```

$T_0$ is the temperature the filament enters at, e.g. ambient, chamber, or dryer temperature.

The two halves answer different questions:

- **$E_\text{melt}$** is the first concern, reaching $T_m$, though higher nominal block temperatures are required for low viscosity and to achieve acceptable maximum flow. Running the nozzle 40 °C hotter does not require a longer hotend.
- **$E_\text{set}$** is the additional energy required to achieve typical printing and extrusion temperatures above $T_m$. The polymer is allowed to drop below this total energy budget at maximum flow rate, as it is assumed that at high flows the polymer will still be above $T_m$ but below $T_\text{set}$. This may be responsible for some of the progressive weakening over a large flow regime described above, as the molten thermopolymer exits the nozzle at progressively lower temperature and layer bonding becomes incomplete due to insufficient remelting of the surface of the previous layer.

Not considering the starting temperature of the filament often contributes a large error in back-of-envelope hotend calculations. High hotend temperature materials like PEEK and PEI require an elevated chamber temperature (typically 120 to 200 °C) for layer bonding, and given the slow speed of printing the polymer has pre-equilibrated close to chamber temperature.

For amorphous polymers "the melting point" is not clearly defined, so the database records instead the lowest temperature at which the polymer flows well enough to extrude, which is the temperature the split belongs at.

---

## 3. Melt-zone-limited flow

The governing relation:

```math
Q_\text{max} = \frac{q \, L}{E_\text{melt}}
```

for effective melt zone length $L$ and **specific power** $q$, the heat a millimetre of melt zone can couple into the filament, in W/mm.

The dimensional argument is trivial; $\mathrm{W/mm} \times \mathrm{mm} \div \mathrm{J/mm^3} = \mathrm{mm^3/s}$

### 3.1 Why there is no closed form for $q$

The honest answer to "what is $q$" is a conjugate heat-transfer problem: conduction through a filament-sized channel of a material with thermal conductivity around $0.2\ \mathrm{W/m\cdot K}$, roughly that of wood, with a moving boundary at the melt front, an annular melt film whose thickness varies down the channel, and a geometry that differs for every hotend on the market. Solving it properly requires the internal geometry of each block, which is not public for most of them.

So $q$ is not derived. It is **calibrated on a reference condition**:

> A standard nozzle running PLA sustains about $1.2\ \mathrm{mm^3/s}$ for every millimetre of melt zone.

Inverting the governing relation at that condition:

```math
q = \left(\frac{Q}{L}\right)_\text{ref} \times E_\text{melt,\,ref}
```

which currently gives $q \approx 0.43\ \mathrm{W/mm}$ in a copper block.

### 3.2 Why calibrate in W/mm rather than mm³/s/mm

Because the rule of thumb as usually stated, "1 mm³/s per mm", is implicitly a statement about PLA. It is a *flow* figure, and flow depends on the polymer. Converting it to a power dissipation figure strips the material out, leaving a quantity that describes the hotend alone. A polymer that costs twice the energy per mm³ then gets half the flow from the same hardware, which can be derived from easily available reference data rather than from melt index values that are often unavailable and may not translate effectively to FDM conditions.

This is what makes the model transferable across materials at all, and it is the reason the material comparison view exists.

### 3.3 Block material

Block conductivity enters as a multiplicative derate on $q$, not on $L$:

| Block | Derate | $q$ |
|---|---|---|
| Copper | 0 % | $q$ |
| Aluminium | 20 % | $0.80\,q$ |
| Brass, steel | 30 % | $0.70\,q$ |

A brass block is not a shorter copper one. It has the same heated length and moves heat into it less effectively, so it belongs on the intensity term. Modelling it as a length reduction would give the wrong residence time, which does not depend on block conductivity at all.

The values are round numbers, not measurements. They are ordered correctly and roughly align with observed copper to aluminium and copper to brass flow differences, but the second digit is not defensible.

An attentive reader will note the divergence from the fold changes in nominal thermal conductivity between copper, aluminium and brass (roughly 385, 205 and 110 $\mathrm{W\,m^{-1}\,K^{-1}}$ respectively). This is not unexpected, given that the low thermal conductivity of the polymer dominates, since polymer, melt zone and heater are in series.

---

## 4. Superheat

Conduction into the filament scales with the temperature difference driving it. The setpoint is not that difference; the excess over the melting point is. So $q$ carries a multiplier, to model the experimentally observed increase in flow at higher $T_\text{set}$:

```math
f(T_\text{set}) = \min\!\left[ \left( \frac{\Delta T_\text{set}}{\Delta T_\text{ref}} \right)^{\!n},\; f_\text{max} \right]
\qquad
\Delta T_\text{set} = T_\text{set} - T_m
\qquad
\Delta T_\text{ref} = T_\text{ref} - T_m
```

where $T_\text{ref}$ is the material's own recommended setpoint, $f_\text{max} = 2$ (which is the theoretical value), and

```math
n = \log_2 1.5 \approx 0.585
```

### 4.1 Why a power law

Three conditions have to hold simultaneously:

1. $f = 0$ at the melting point. No driving temperature difference, no flow.
2. $f = 1$ at the material's normal setpoint. The calibration is anchored there, so anything else would mean the reference condition disagreed with itself.
3. $f$ is less than proportional above it. A hotter nozzle buys less than linear gain, because the extra heat still has to cross the same badly-conducting polymer, the melt film nearest the wall thins and takes more of the temperature drop, and viscosity falls faster than the melt front advances.

No straight line satisfies all three. A line through $(0,0)$ and $(1,1)$ is forced to give $2\times$ at twice the superheat, which is condition 3 violated. A power law through the same two points has a free exponent, and $n$ is set by choosing the damping directly: *twice the superheat is worth 1.5× the flow*, hence $n = \log_2 1.5$.

The cap at $f_\text{max}=2$ is reached at about $3.3\times$ normal superheat. Above that the model has no business extrapolating: the polymer is degrading and nozzle pressure, which this model does not represent at all, is the real limit.

I would be very skeptical of the applicability of these equations outside of typical printing regimes, even if they may be theoretically permissible by the equation. For PLA I have little confidence in any degree of accuracy outside of the 190 to 240 °C range.

### 4.2 A known weakness: the denominator is not physical

$\Delta T_\text{ref}$ is *each material's own recommended setpoint window*, what a polymer is typically printed at. That makes $f$ exactly 1 at defaults, which is the property the calibration needs. But the recommended setpoint is an editorial number in a CSV, not a property of the polymer, and it appears in the denominator, so it sets the **sensitivity** of every material to a temperature override.

The consequence, measured across the database for an E3D V6:

| Material | $T_m$ | $T_\text{ref}$ | Window | Flow gain from +20 °C |
|---|---|---|---|---|
| HDPE | 130 | 220 | 90 K | +12 % |
| PLA | 160 | 220 | 60 K | +18 % |
| PETG | 210 | 240 | 30 K | +35 % |
| PET | 250 | 275 | 25 K | +41 % |
| LCP | 280 | 300 | 20 K | +50 % |

The same 20 °C is worth four times as much in LCP as in HDPE, and nothing physical explains the difference. Revising a recommended setpoint in the database, a purely editorial act, changes how much a temperature override is worth for that polymer.

There is a second-order symptom. Narrow-window materials collapse abruptly as the setpoint approaches $T_m$, because $\Delta T_\text{set} \to 0$ while $\Delta T_\text{ref}$ stays small:

| $T_\text{set}$ (LCP) | $f$ | $Q_\text{max}$, V6 |
|---|---|---|
| 300 °C | 1.000 | 12.03 mm³/s |
| 290 °C | 0.667 | 8.02 |
| 285 °C | 0.444 | 5.35 |
| 281 °C | 0.173 | 2.09 |
| 280 °C | 0.000 | 0.00 |

Zero at $T_m$ is defensible, since the polymer is not melting, but it arrives 20 °C below a normal setpoint.

Two candidate repairs, neither yet adopted:

- **Fixed temperature scale.** $f = \left(1 + (T_\text{set} - T_\text{ref})/K\right)^n$ for a global $K$ in kelvin. Still unity at defaults, but +20 °C is worth the same everywhere, and there is no zero.
- **Floor the denominator.** $\Delta T_\text{ref} \leftarrow \max(\Delta T_\text{ref}, 40)$. A one-line change that removes the hypersensitivity of narrow-window materials and leaves everything else alone.

Both are model changes and both reprice every chart, which is why they are documented here rather than applied.

---

## 5. Effective melt zone length

$L$ is not a measurement with a ruler. It is the length that behaves like melt zone, and the database stores it separately from the physical heated channel because for some hotends the two genuinely differ.

```math
L = \underbrace{L_\text{eff}}_{\text{database}} + \underbrace{\ell_\text{mze}}_{8.5\ \text{mm}} + \underbrace{\ell_\text{hf}}_{8.5\ \text{mm}} - \underbrace{\ell_\text{taper}}_{3.5\ \text{mm}}
```

with the extender and high-flow terms present only when fitted, and the result floored at zero.

$L_\text{eff}$ represents the portion of the filament path thermally coupled to the heater (e.g. parts of the block, nozzle, and heatbreak threads) that are not part of the thermal isolation structure (e.g. the heatbreak tube).

### 5.1 Multiple bores

A block with $k$ filament paths carries $k$ times the wall area and melts $k$ times the plastic, so its stored $L_\text{eff}$ is the total across bores. The single-bore physical length is stored separately for display. This is why a dual-path hotend reports a melt zone far longer than anything you could measure on it, and it is correct for flow: the figure is the whole hotend's capacity.

The actual calculation of the effective melt zone length for a multi-bore hotend is a little different on the backend, as the multiple bore region is assumed to be present only before the nozzle (roughly 15 mm behind the nozzle tip).

Residence time then resolves correctly by construction, because both $L$ and $Q$ carry the factor of $k$ and it cancels, see §7.

### 5.2 High-flow nozzles

A CHT-style nozzle adds no length. It splits the bore into several channels, which raises wall area per unit length substantially. Modelling that as an equivalent 8.5 mm of extra melt zone is a convenience, not a claim about geometry: it buys a comparable amount of melting capacity, which is the only quantity this model tracks.

It applies to $L$ alone and not to the physical channel, which is why the table reports the two columns separately. A hotend with such geometry built in carries the equivalence in its stored $L_\text{eff}$ rather than as a fitted option.

### 5.3 The taper allowance

A flat 3.5 mm is deducted from $L$.

Measured back from the tip, 3.5 mm falls near the middle of a V6 nozzle's hex, approximately where the bore begins converging on the orifice. Past that point two things stop being true: wall area against the filament becomes small, and the pressure gradient through the convergence no longer assists transfer. Additionally the nozzle surface is typically cooled by part cooling airflow and thus is cooler than the rest of the block.

It is **fixed rather than proportional** because the taper is a property of the nozzle, and the nozzle does not get longer when the block does. This is also the term that reconciles the model with reported figures at the long end: without it, a 60 mm melt zone is overestimated by a margin that a proportional correction cannot reproduce, because the error is a constant offset and not a constant fraction.

This may in fact be a post-hoc rationalisation of a correction factor that corrects nonlinearity in melt zone behaviour through a different mechanism. I am not certain whether this is the case and am doing further research on this topic, though the inclusion of this secondary correction to melt zone length seems to give more accurate behaviour. Defining nominal melt zone as the full block to nozzle tip measurement is an ease of measurement choice, though treating only the block and not the nozzle as active melt zone would also be defensible, and would lead to the opposite issue, as short blocks would outperform actual measured flow relative to long hotends because they have a greater percentage of "extra" unaccounted for nozzle length.

---

## 6. Heater power

```math
P = \frac{Q \, E_\text{set}}{\eta}, \qquad \eta = 32.5\,\%
```

Note $E_\text{set}$, not $E_\text{melt}$: unlike the melt zone, the heater does pay for the superheat.

$\eta$ is the share of a cartridge's rated output that ends up in the plastic. The rest holds the block at temperature and leaks into the mount, the nozzle and the moving air. It is a fixed constant rather than a setting because it is not something a user knows about their machine, and because it varies far less between hotends than the melt zone lengths this app is actually about.

*This is immensely dependent on print settings. A larger difference between chamber and nozzle temperature, as well as high part cooling fan speeds, increases convective heat losses greatly.* **Treat these values for heater requirements as very rough approximations. This is why a generous overhead in heater selection is recommended by the model.**

**$P$ is reported, not imposed.** The model does not constrain $Q$ by heater power; the cartridge is assumed to be sized for the hotend. This is a deliberate scoping decision, since an undersized heater is a fixable problem and a short melt zone is not, but it means the flow figures assume you have fitted the wattage the tool recommends.

The recommendation snaps to a stocked cartridge size and then takes **one size past** the smallest that covers the requirement. Everything feeding $P$ is steady-state: it pays for plastic and nothing else. A real cartridge also has to bring the block up from cold, hold setpoint against the part fan, and recover when a cold length of filament arrives. Skipping a size buys the reserve for all of it.

---

## 7. Residence time

```math
t = \frac{A \, L}{Q}
```

with $A$ the feedstock cross-section, $\approx 2.405\ \mathrm{mm^2}$ at 1.75 mm.

This is the time the hotend has to get heat from the wall into the middle of the filament, and it falls as $1/Q$. It is the reason fast printing needs a longer melt zone rather than merely a hotter one: above a certain speed no temperature gets heat to the core in the time available, and the extrudate leaves with a solid thread down its centre.

Larger feedstock raises $A$ and lowers feed velocity in proportion, so at fixed $Q$ residence time scales with $A$. On a multi-bore block both $L$ and $Q$ carry the bore count, so $t$ resolves to what a single path sees, the physically meaningful quantity, since each strand is heated independently.

Bore diameter deliberately does **not** scale the flow ceiling in §3. That ceiling is a power balance, and neither term is a function of bore: thicker filament needs proportionally more energy per millimetre of its own length, which the energy term already charges for, and it buys proportionally more residence time in the same melt zone. What the model misses is that the heat has further to travel inwards, so 2.85 mm figures are optimistic, in the same direction as everything else here.

---

## 8. Derived comparisons

### 8.1 Flow classes

The community's SF / HF / UHF / UUHF labels are not this model's invention and are not derived from it. They are quoted as flow rates **for PLA**, and the boundaries are scaled for anything else by how much flow a millimetre of melt zone is worth in the current material against the reference:

```math
Q_\text{boundary}(\text{material}) = Q_\text{boundary,\,PLA} \times \frac{q\,f / E_\text{melt}}{(Q/L)_\text{ref}}
```

Because every hotend's flow and every boundary move by the same factor, changing material relabels the axis without moving anybody between classes. What *does* move a hotend is anything that changes what it delivers relative to its peers: an extender, a high-flow nozzle, or a block that gives some of it back.

### 8.2 Value index

Price against flow, fitted over every priced hotend in the database:

```math
\hat{Q}(p) = a + b \ln p
```

Against $\ln p$ rather than $p$ because prices span two and a half orders of magnitude; a fit on raw dollars would be set almost entirely by the handful of four-figure hotends and would say nothing about the twenty people actually cross-shop.

Each hotend then gets one number:

```math
V = \frac{Q_\text{max}}{\hat{Q}(p)}
```

$V = 1$ is the going rate, $V = 0.8$ is a fifth less flow than the money usually buys. Normalising this way is what lets a \$12 hotend and a \$370 one be compared at all: both are asked the same question, so their answers can share a box plot.

The fit is over the whole database rather than the current comparison, deliberately. The question is what the market charges for a given flow, and a shortlist cannot answer that, it is the thing being measured against it.

---

## 9. Discussion: where this model is weakest

Ordered roughly by the severity of each limitation.

**No pressure or viscosity model.** This is the largest omission. The model answers "can this hotend melt the polymer at this rate" and says nothing about whether the extruder can push it through the nozzle at that rate. A hotend that clears the melt requirement may still fail on pressure, and for high-viscosity polymers at small nozzle diameters that is often the binding constraint. The practical flow factors in the material views are an editorial acknowledgement of this, and they are deliberately excluded from the flow model rather than smuggled into it.

**Radial conduction is not resolved.** Residence time is reported, but nothing enforces a minimum. The model has no notion of a temperature profile across the filament, so it cannot tell you that the core left solid. Thermal conductivity differs between polymers by a factor of two or so and is not represented at all.

**The superheat denominator.** See §4.2. Known to be non-physical, with two candidate revisions.

**Steady state throughout.** No transients: no cold block, no part fan, no thermal recovery after a retraction, no gradient down the block. Real printing is not steady state, and the model's numbers are ceilings that a machine touches rather than holds.

**Geometry is one number.** Two hotends with the same effective length are indistinguishable here. Thermal mass, wall thickness, the shape of the transition, and whether the heatbreak is bimetal or lined are all not considered. The taper allowance is the only geometric correction, and it is a single constant applied identically to everything.

**Material properties are typical published values.** Not brand-specific measurements. A filled filament can differ substantially from the unfilled polymer in every property here, and no composites are represented.

**One calibration constant carries everything.** If the reference figure is wrong, every number moves together. This is the model's greatest weakness and its main defence: an error in it changes the scale and not the ordering, and the ordering is what the tool is for.

---

## 10. What the numbers are for

Comparison, not prediction.

The output is best read as: *of these hotends, in this polymer, at this speed, which ones have headroom and which do not, and by roughly how much.* Read that way the model is reasonably robust, since the systematic errors are shared and largely cancel.

Read as absolute prediction it will disappoint, and the second decimal place is fiction in every figure on the site.
