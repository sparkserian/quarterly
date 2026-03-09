interface QuarterlyWordmarkProps {
  className?: string;
  showBadge?: boolean;
}

export function QuarterlyWordmark({ className = '', showBadge = false }: QuarterlyWordmarkProps) {
  return (
    <div className={`quarterly-wordmark ${className}`.trim()}>
      <svg
        aria-hidden="true"
        className="quarterly-wordmark-mark"
        viewBox="0 0 84 18"
      >
        <path
          d="M1 1H33V6H21V17H13V6H1V1ZM42 1H78V6H42V1ZM72 1H80V17H72V1ZM49 7H77V11H49V7ZM42 12H78V17H42V12Z"
          fill="currentColor"
        />
      </svg>
      <span className="quarterly-wordmark-name">Quarterly</span>
      {showBadge ? <span className="quarterly-wordmark-badge">Alpha</span> : null}
    </div>
  );
}
