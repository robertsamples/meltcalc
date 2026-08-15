/**
 * Definitions for the terms the app uses without explaining them, and the full names behind the
 * abbreviations in the material database.
 *
 * Reference data rather than user data, which is why it lives here and not in `data/materials.csv`:
 * a polymer's proper name is a fact about chemistry, not a number anyone tunes.
 */

export const GLOSSARY: Record<string, string> = {
	amorphous:
		'The chains never line up into an ordered structure. An amorphous polymer softens over a range instead of melting at a temperature, and pays no heat of fusion.',
	'semi-crystalline':
		'Part of the material is ordered and part is not. The ordered fraction melts at a definite temperature and costs extra energy to get through.',
	crystallinity:
		'The fraction of the material that is ordered. It sets how much of the textbook heat of fusion is actually paid: printed parts reach well under half of the fully ordered value.',
	'heat of fusion':
		'Energy absorbed at the melting point to pull ordered chains apart, on top of the energy that simply raises the temperature. Zero for amorphous polymers.',
	'specific heat capacity': 'Energy needed to raise one gram of the material by one kelvin.',
	'glass transition':
		'Tg — where an amorphous polymer changes from rigid to rubbery. Not a melting point; the material is already flowing well before it prints.',
	'melting point':
		'Tm — where the ordered regions become fluid. Amorphous polymers have none, so the figure shown for them is the lowest temperature at which they flow.',
	superheat: 'How far the nozzle setpoint sits above the melting point.',
	'melt zone': 'The heated length of channel the filament passes through on its way to the nozzle.',
	'residence time': 'How long one piece of filament spends inside the melt zone.',
	'volumetric flow':
		'Plastic leaving the nozzle per second, in mm³/s. It is the quantity a hotend actually limits — layer height, line width and speed only decide how it is spent.',
	density: 'Mass per unit volume of the solid, since a mm³ of finished print is a mm³ of solid.'
};

/**
 * Full chemical names, keyed by the name in the material database.
 *
 * The polyesters carry more than a name because their differences are the interesting part: PET,
 * PETG and PCTG are the same two monomers in different proportions, and that ratio is the whole
 * reason one crystallises and the others do not.
 */
export const POLYMER_NAMES: Record<string, string> = {
	PLA: 'Polylactic acid',
	PET: 'Poly(ethylene terephthalate): terephthalic acid with ethylene glycol (EG) and no CHDM, which is why it crystallises where the glycol-modified grades cannot.',
	PETG: 'Poly(ethylene terephthalate), glycol-modified: some of the ethylene glycol (EG) in the backbone is replaced by 1,4-cyclohexanedimethanol (CHDM). The ratio varies between brands, so PETG is a family rather than one material.',
	PCTG: 'Poly(cyclohexylenedimethylene terephthalate), glycol-modified: the same two monomers as PETG — 1,4-cyclohexanedimethanol (CHDM) and ethylene glycol (EG) — but CHDM-rich rather than EG-rich, which makes it tougher.',
	ABS: 'Acrylonitrile butadiene styrene',
	ASA: 'Acrylonitrile styrene acrylate',
	HIPS: 'High-impact polystyrene',
	PA6: 'Polyamide 6 (nylon 6)',
	PA12: 'Polyamide 12 (nylon 12)',
	PA66: 'Polyamide 6,6 (nylon 6,6)',
	PPA: 'Polyphthalamide',
	PEBA: 'Polyether block amide',
	PP: 'Polypropylene',
	HDPE: 'High-density polyethylene',
	TPU: 'Thermoplastic polyurethane',
	PC: 'Polycarbonate',
	'POM (Acetal)': 'Polyoxymethylene',
	PVDF: 'Polyvinylidene fluoride',
	PVB: 'Polyvinyl butyral',
	PVA: 'Polyvinyl alcohol',
	BVOH: 'Butenediol vinyl alcohol copolymer',
	'PMMA (acrylic)': 'Poly(methyl methacrylate)',
	PHA: 'Polyhydroxyalkanoate',
	PCL: 'Polycaprolactone',
	PBT: 'Poly(butylene terephthalate)',
	PPS: 'Polyphenylene sulfide',
	PEEK: 'Polyether ether ketone',
	PEKK: 'Polyether ketone ketone',
	'PEI (ULTEM 9085)':
		'Polyetherimide. 9085 is not pure PEI: it is blended with polycarbonate, which is what makes it easier to print and less stiff than 1010.',
	'PEI (ULTEM 1010)': 'Polyetherimide, unblended — stiffer, more chemically resistant and hotter to run than 9085.',
	PPSU: 'Polyphenylsulfone',
	PSU: 'Polysulfone',
	PES: 'Polyethersulfone',
	TPI: 'Thermoplastic polyimide',
	LCP: 'Liquid crystal polymer',
	'PPE+PS': 'Polyphenylene ether blended with polystyrene',
	PVC: 'Polyvinyl chloride'
};
