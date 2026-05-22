import Anser from "anser";
import { useEffect, useMemo, useRef } from "react";

export type TerminalLine = {
  seq: number;
  step: string;
  stream: string;
  line: string;
};

type Segment = {
  content: string;
  className: string;
};

function parseLine(line: string): Segment[] {
  const chunks = Anser.ansiToJson(line, { use_classes: true, remove_empty: true });
  return chunks.map((c) => {
    const classes: string[] = [];
    if (c.fg) classes.push(c.fg);
    if (c.bg) classes.push(c.bg);
    for (const d of c.decorations) classes.push(`ansi-${d}`);
    return { content: c.content, className: classes.join(" ") };
  });
}

function LineRow({ line }: { line: TerminalLine }) {
  const segments = useMemo(() => parseLine(line.line), [line.line]);
  return (
    <div className="term-row" data-stream={line.stream}>
      {segments.length === 0
        ? " "
        : segments.map((s, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are derived from immutable line text
            <span key={i} className={s.className || undefined}>
              {s.content}
            </span>
          ))}
    </div>
  );
}

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
        lines.map((l) => <LineRow key={l.seq} line={l} />)
      )}
    </div>
  );
}
