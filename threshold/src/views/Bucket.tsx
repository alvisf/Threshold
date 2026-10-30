import { useEffect, useId, useState } from 'react';
import { ALERT_AT, LEVEL_LABEL, type Level } from '../logic/bucket';

const TOP = 26, BOTTOM = 152, H = BOTTOM - TOP;
const SHAPE = 'M22 26 H138 L121 146 Q120 152 114 152 H46 Q40 152 39 146 Z';

/** The fill starts empty and eases up to the score, so a change is seen, not read. */
export function BucketGauge({ score, level }: { score: number; level: Level }) {
  const id = useId().replace(/:/g, '');
  const target = Math.min(100, Math.max(0, score));
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setShown(target)); });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [target]);
  const drop = (H * (100 - shown)) / 100;
  const lineY = BOTTOM - (H * ALERT_AT) / 100;
  return (
    <div className={`gauge lv-${level}`}>
      <svg viewBox="0 0 160 166" role="img" aria-label={`Bucket ${score}% full. ${LEVEL_LABEL[level]}.`}>
        <defs><clipPath id={`bk${id}`}><path d={SHAPE} /></clipPath></defs>
        <path className="g-handle" d="M30 28 C40 -2 120 -2 130 28" />
        <path className="g-body" d={SHAPE} />
        <g clipPath={`url(#bk${id})`}>
          <rect className="g-fill" x="0" y={TOP} width="160" height={166 - TOP} style={{ transform: `translateY(${drop}px)` }} />
        </g>
        <line className="g-line" x1="16" x2="144" y1={lineY} y2={lineY} />
        <path className="g-rim" d={SHAPE} />
      </svg>
      <div className="g-text">
        <b>{score}%</b>
        <span>{LEVEL_LABEL[level]}</span>
      </div>
    </div>
  );
}
