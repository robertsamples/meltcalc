import z from 'zod/v4';

/**
 * Branded number types for the quantities the calculator deals in.
 *
 * They are zod schemas as well as types, so the same declaration both parses a shared link and
 * keeps a temperature from being passed where a flow rate belongs. Add units here as the model
 * grows rather than reaching for bare `number`.
 */

export const Celsius = z.number().brand('°C');
export type Celsius = z.infer<typeof Celsius>;
/** A temperature *difference*. Kelvin and Celsius spans are the same size, the zero differs */
export const Kelvin = z.number().brand('K');
export type Kelvin = z.infer<typeof Kelvin>;
export const Millimeter = z.number().brand('mm');
export type Millimeter = z.infer<typeof Millimeter>;
export const SquareMillimeter = z.number().brand('mm²');
export type SquareMillimeter = z.infer<typeof SquareMillimeter>;
export const CubicMillimeter = z.number().brand('mm³');
export type CubicMillimeter = z.infer<typeof CubicMillimeter>;
export const MillimetersPerSecond = z.number().brand('mm/s');
export type MillimetersPerSecond = z.infer<typeof MillimetersPerSecond>;
export const CubicMillimetersPerSecond = z.number().brand('mm³/s');
export type CubicMillimetersPerSecond = z.infer<typeof CubicMillimetersPerSecond>;
export const Seconds = z.number().brand('s');
export type Seconds = z.infer<typeof Seconds>;
export const Grams = z.number().brand('g');
export type Grams = z.infer<typeof Grams>;
export const GramsPerCubicCentimeter = z.number().brand('g/cm³');
export type GramsPerCubicCentimeter = z.infer<typeof GramsPerCubicCentimeter>;
export const JoulesPerGram = z.number().brand('J/g');
export type JoulesPerGram = z.infer<typeof JoulesPerGram>;
export const JoulesPerGramKelvin = z.number().brand('J/(g·K)');
export type JoulesPerGramKelvin = z.infer<typeof JoulesPerGramKelvin>;
export const JoulesPerCubicMillimeter = z.number().brand('J/mm³');
export type JoulesPerCubicMillimeter = z.infer<typeof JoulesPerCubicMillimeter>;
export const Watts = z.number().brand('W');
export type Watts = z.infer<typeof Watts>;
/** Power per millimetre of melt zone: the quantity that decides whether a hotend keeps up */
export const WattsPerMillimeter = z.number().brand('W/mm');
export type WattsPerMillimeter = z.infer<typeof WattsPerMillimeter>;
/** Flow a hotend sustains per millimetre of melt zone; the calibration constant of this model */
export const CubicMillimetersPerSecondPerMillimeter = z.number().brand('mm³/(s·mm)');
export type CubicMillimetersPerSecondPerMillimeter = z.infer<typeof CubicMillimetersPerSecondPerMillimeter>;
/** Street price. `PLACEHOLDER_PRICE` marks the ones nobody has filled in yet */
export const Dollars = z.number().brand('$');
export type Dollars = z.infer<typeof Dollars>;
export const DollarsPerFlow = z.number().brand('$/(mm³/s)');
export type DollarsPerFlow = z.infer<typeof DollarsPerFlow>;
export const Percent = z.number().brand('%');
export type Percent = z.infer<typeof Percent>;
