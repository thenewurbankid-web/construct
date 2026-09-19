import { BaseEdge, type EdgeProps } from '@xyflow/react';

type Pt = { x: number; y: number };

// Smooth route through the points the layout computed (S-curves with
// horizontal tangents at every point), so the line passes through the box
// the layout reserved for its label. The first/last points are replaced by
// the real handle positions so arrowheads and reconnect anchors line up.
function routePath(points: Pt[], from: Pt, to: Pt): string {
  const pts = [from, ...points.slice(1, -1), to];
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const mx = (a.x + b.x) / 2;
    d += ` C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
  }
  return d;
}

export function FlowEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, style, label, data }: EdgeProps) {
  const points = (data?.points as Pt[] | undefined) ?? [];
  const path =
    points.length >= 2 ? routePath(points, { x: sourceX, y: sourceY }, { x: targetX, y: targetY }) : `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={style}
      label={label}
      labelX={data?.labelX as number | undefined}
      labelY={data?.labelY as number | undefined}
      labelBgPadding={[4, 3]}
      labelBgBorderRadius={3}
      labelShowBg
    />
  );
}
