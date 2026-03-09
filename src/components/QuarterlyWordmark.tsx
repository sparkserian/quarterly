interface QuarterlyWordmarkProps {
  className?: string;
  showBadge?: boolean;
}

export function QuarterlyWordmark({ className = '', showBadge = false }: QuarterlyWordmarkProps) {
  return (
    <div className={`quarterly-wordmark ${className}`.trim()}>
      <span className="quarterly-wordmark-name">Quarterly</span>
      {showBadge ? <span className="quarterly-wordmark-badge">Alpha</span> : null}
    </div>
  );
}
