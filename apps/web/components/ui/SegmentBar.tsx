export interface SegmentBarProps {
  total: number;
  filled: number;
  fillColor: string;
  emptyColor: string;
  ariaHidden?: boolean;
}

export function SegmentBar({ total, filled, fillColor, emptyColor, ariaHidden = true }: SegmentBarProps) {
  const clampedFilled = Math.max(0, Math.min(filled, total));

  return (
    <div className="flex gap-[2px]" aria-hidden={ariaHidden || undefined}>
      {Array.from({ length: total }, (_, index) => {
        const isFilled = index < clampedFilled;
        return (
          <div
            key={index}
            className="h-1 flex-1 rounded-none"
            data-filled={isFilled}
            style={{ background: isFilled ? fillColor : emptyColor }}
          />
        );
      })}
    </div>
  );
}
