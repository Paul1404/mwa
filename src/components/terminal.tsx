import { useEffect, useRef } from "react";

export type TerminalLine = {
  seq: number;
  step: string;
  stream: string;
  line: string;
};

export function Terminal({
  lines,
  autoscroll = true,
}: {
  lines: TerminalLine[];
  autoscroll?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on length change
  useEffect(() => {
    if (!autoscroll || !ref.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [autoscroll, lines.length]);

  return (
    <div
      ref={ref}
      className="term bg-black/70 rounded-md border border-[color:var(--color-border)] overflow-auto max-h-[70vh] min-h-[300px]"
    >
      {lines.length === 0 ? (
        <div className="term-row text-[color:var(--color-muted)]">Waiting for output...</div>
      ) : (
        lines.map((l) => (
          <div key={l.seq} className="term-row" data-stream={l.stream}>
            {l.line.length === 0 ? " " : l.line}
          </div>
        ))
      )}
    </div>
  );
}
