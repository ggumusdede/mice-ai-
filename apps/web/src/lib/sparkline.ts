/** Map a numeric series to SVG coordinates (y inverted). Flat series is drawn at mid-height. */
export function sparklinePoints(values: number[], width: number, height: number, pad = 2): { x: number; y: number }[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  return values.map((v, i) => ({
    x: pad + (values.length === 1 ? innerW / 2 : (i * innerW) / (values.length - 1)),
    y: span === 0 ? height / 2 : pad + innerH - ((v - min) / span) * innerH,
  }));
}
