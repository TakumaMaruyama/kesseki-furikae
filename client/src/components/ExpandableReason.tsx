import { useEffect, useId, useRef, useState } from "react";

type ExpandableReasonProps = {
  reason?: string | null;
};

export function ExpandableReason({ reason }: ExpandableReasonProps) {
  const normalizedReason = reason?.trim() ?? "";
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const paragraphRef = useRef<HTMLParagraphElement>(null);
  const contentId = useId();

  useEffect(() => {
    setIsExpanded(false);
    setIsOverflowing(false);
  }, [normalizedReason]);

  useEffect(() => {
    const element = paragraphRef.current;
    if (!element || isExpanded) return;

    const updateOverflow = () => {
      setIsOverflowing(element.scrollHeight > element.clientHeight + 1);
    };

    updateOverflow();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isExpanded, normalizedReason]);

  if (!normalizedReason) return null;

  return (
    <div className="mt-1 min-w-0">
      <p
        ref={paragraphRef}
        id={contentId}
        className={`whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground ${
          isExpanded ? "" : "line-clamp-2"
        }`}
      >
        <span className="font-medium text-foreground/70">理由：</span>
        {normalizedReason}
      </p>
      {(isOverflowing || isExpanded) && (
        <button
          type="button"
          className="mt-0.5 rounded-sm text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-expanded={isExpanded}
          aria-controls={contentId}
          onClick={() => setIsExpanded((expanded) => !expanded)}
        >
          {isExpanded ? "折りたたむ" : "もっと見る"}
        </button>
      )}
    </div>
  );
}
