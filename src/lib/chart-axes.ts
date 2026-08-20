/**
 * The shape recharts hands a `Customized` child.
 *
 * Anything drawn by hand inside a chart — the price bands, the flow-class strip, the boxes — needs
 * the scales recharts has already laid out, and they arrive as these maps rather than as props with
 * a published type. Declared once here so three charts cannot each guess at it slightly differently.
 */

export type Scale = { domain: () => number[]; (value: number): number };

export type AxisMap = Record<string, { scale: Scale }>;
