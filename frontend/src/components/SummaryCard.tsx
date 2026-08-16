/**
 * A headline figure in a card of its own — the row of totals at the top of a
 * page.
 *
 * Distinct from `Stat`, which is bare and meant to sit several-to-a-row inside
 * something else. The difference is not cosmetic: this one owns its background
 * and can carry an accent ring, so it reads as a thing rather than as a label.
 */
export function SummaryCard({
  label,
  value,
  color,
  accent,
  children,
}: {
  label: string;
  value: string;
  color?: string;
  /** Rings the card, for the figure that is the reason to look at the page. */
  accent?: boolean;
  /** Optional line under the value — a timestamp, a qualifier. */
  children?: React.ReactNode;
}) {
  return (
    <div className="card" style={accent ? { boxShadow: "0 0 0 1px var(--color-accent)" } : undefined}>
      <div className="eyebrow">{label}</div>
      <div className="heading" style={{ fontSize: 24, color }}>
        {value}
      </div>
      {children}
    </div>
  );
}
