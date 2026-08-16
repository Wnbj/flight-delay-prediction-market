/**
 * A labelled figure, for the rows of facts that sit under a market.
 *
 * Not the same thing as Portfolio's `SummaryCard`, which is a card in its own
 * right with its own padding and accent state. This one is bare on purpose so
 * several can sit in one flex row and read as a group.
 */
export function Stat({
  label,
  value,
  color,
  title,
}: {
  label: string;
  value: string;
  /** Overrides the value colour — used for figures that carry a verdict. */
  color?: string;
  /** Hover text, for values that are truncated in the label. */
  title?: string;
}) {
  return (
    <div title={title}>
      <div
        className="muted"
        style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        {label}
      </div>
      <div className="heading" style={{ fontSize: 18, color }}>
        {value}
      </div>
    </div>
  );
}
