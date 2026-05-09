'use client';

export function Skeleton({
  className = '',
  width,
  height,
}: {
  className?: string;
  width?: number | string;
  height?: number | string;
}) {
  const style: React.CSSProperties = {};
  if (width !== undefined) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height !== undefined) style.height = typeof height === 'number' ? `${height}px` : height;
  return <div className={`skeleton ${className}`} style={style} />;
}

export function PageSkeleton({ width, height }: { width: number; height: number }) {
  // 가짜 텍스트 라인을 페이지 위에 배치
  const lines: Array<{ x: number; y: number; w: number; h: number }> = [];
  let y = 60;
  while (y < height - 80) {
    const blockLines = 3 + Math.floor(((y * 31) % 5));
    for (let i = 0; i < blockLines; i += 1) {
      const widthRatio = 0.5 + (((y + i) * 13) % 40) / 100;
      lines.push({ x: 60, y, w: (width - 120) * widthRatio, h: 12 });
      y += 22;
    }
    y += 28;
  }
  return (
    <div className="paper relative overflow-hidden" style={{ width, height }}>
      {lines.map((l, i) => (
        <div
          key={i}
          className="skeleton absolute"
          style={{ left: l.x, top: l.y, width: l.w, height: l.h }}
        />
      ))}
    </div>
  );
}
