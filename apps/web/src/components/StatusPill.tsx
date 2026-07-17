const statusFor = (score: number) =>
  score >= 80
    ? { label: 'Good', color: 'var(--status-good)' }
    : score >= 50
      ? { label: 'Needs attention', color: 'var(--status-warn)' }
      : score >= 30
        ? { label: 'Serious', color: 'var(--status-serious)' }
        : { label: 'Critical', color: 'var(--status-critical)' };

/** Status is never color alone: dot + label travel together. */
const StatusPill: React.FC<{ score: number }> = ({ score }) => {
  const s = statusFor(score);
  return (
    <span className="status-pill">
      <span className="status-pill__dot" style={{ background: s.color }} aria-hidden="true" />
      {s.label}
    </span>
  );
};

const severityColor: Record<'critical' | 'serious' | 'warning', string> = {
  critical: 'var(--status-critical)',
  serious: 'var(--status-serious)',
  warning: 'var(--status-warn)',
};

export const SeverityPill: React.FC<{ severity: 'critical' | 'serious' | 'warning' }> = ({ severity }) => (
  <span className="status-pill">
    <span className="status-pill__dot" style={{ background: severityColor[severity] }} aria-hidden="true" />
    {severity}
  </span>
);

export default StatusPill;
