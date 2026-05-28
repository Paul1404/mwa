import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { orpcQuery } from "~/lib/orpc";

/**
 * App-wide banner shown whenever one or more stored credentials can no longer
 * be decrypted with the active ENCRYPTION_KEY. Typically happens after a
 * container restart with a rotated key. Click-through goes to the credentials
 * list where each broken row has a "Replace key" CTA.
 */
export function RekeyBanner() {
  const credentials = useQuery({
    ...orpcQuery.credentials.list.queryOptions(),
    // The dashboard already fetches this; reuse the cached value where
    // possible but still refresh when the user lands on another page.
    staleTime: 30_000,
  });

  const broken = credentials.data?.filter((c) => c.needsRekey) ?? [];
  if (broken.length === 0) return null;

  return (
    <div className="border-b border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10">
      <div className="mx-auto max-w-6xl px-6 py-2.5 flex items-center justify-between gap-4 text-sm">
        <div className="flex items-center gap-2 text-[color:var(--color-danger)] min-w-0">
          <KeyRound className="size-4 shrink-0" />
          <span className="truncate">
            {broken.length === 1
              ? "1 credential can't be decrypted with the current ENCRYPTION_KEY."
              : `${broken.length} credentials can't be decrypted with the current ENCRYPTION_KEY.`}{" "}
            Replace the key to recover.
          </span>
        </div>
        <Link
          to="/credentials"
          className="text-xs font-medium text-[color:var(--color-danger)] hover:underline shrink-0"
        >
          Review
        </Link>
      </div>
    </div>
  );
}
