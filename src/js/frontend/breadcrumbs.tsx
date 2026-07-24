type BreadcrumbItem = {
  label: string;
  href?: string;
  onClick?: () => void;
  current?: boolean;
};

type BreadcrumbsProps = {
  items: BreadcrumbItem[];
  className?: string;
};

export function Breadcrumbs({ items, className = '' }: BreadcrumbsProps) {
  if (items.length === 0) return null;

  return (
    <nav
      className={`stims-shell__breadcrumbs ${className}`}
      aria-label="Breadcrumb"
    >
      {items.map((item, index) => (
        <span key={item.label} className="stims-shell__breadcrumb-wrapper">
          {item.current ? (
            <span className="stims-shell__breadcrumb" aria-current="page">
              {item.label}
            </span>
          ) : item.href ? (
            <a className="stims-shell__breadcrumb" href={item.href}>
              {item.label}
            </a>
          ) : item.onClick ? (
            <button
              type="button"
              className="stims-shell__breadcrumb"
              onClick={item.onClick}
            >
              {item.label}
            </button>
          ) : (
            <span className="stims-shell__breadcrumb">{item.label}</span>
          )}
          {index < items.length - 1 ? (
            <span
              className="stims-shell__breadcrumb-separator"
              aria-hidden="true"
            >
              /
            </span>
          ) : null}
        </span>
      ))}
    </nav>
  );
}
