import { pct } from '../lib/format';
import { sparklinePoints } from '../lib/sparkline';

/** Simple inline SVG sparkline (weekly correction-rate trend). Values are fractions 0..1. */
export function Sparkline({ values, width = 160, height = 40, label }: { values: number[]; width?: number; height?: number; label: string }) {
  if (!values.length) return <span className="muted">—</span>;
  const pts = sparklinePoints(values, width, height, 4);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${path} L${pts[pts.length - 1].x.toFixed(1)},${height} L${pts[0].x.toFixed(1)},${height} Z`;
  const last = pts[pts.length - 1];
  const desc = `${label}: ${values.map((v) => pct(v, 0)).join(', ')}`;
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={desc}>
      <path d={area} className="sparkline__area" />
      <path d={path} className="sparkline__line" fill="none" />
      <circle cx={last.x} cy={last.y} r={3.5} className="sparkline__dot" />
    </svg>
  );
}
