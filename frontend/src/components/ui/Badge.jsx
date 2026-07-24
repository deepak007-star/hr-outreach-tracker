/**
 * Badge / pill chip — for skill tags, tech stack, categories, counts.
 * Separate from StatusPill (which is semantic/status-specific).
 */
export default function Badge({ children, variant = 'default', className = '' }) {
  const cls = {
    default:  'bg-gray-100  text-gray-600  border-gray-200',
    brand:    'bg-brand-50  text-brand-700 border-brand-200',
    success:  'bg-green-50  text-green-700 border-green-200',
    warning:  'bg-amber-50  text-amber-700 border-amber-200',
    danger:   'bg-red-50    text-red-700   border-red-200',
    info:     'bg-blue-50   text-blue-700  border-blue-200',
    purple:   'bg-violet-50 text-violet-700 border-violet-200',
  }[variant] ?? 'bg-gray-100 text-gray-600 border-gray-200';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-sm border leading-none ${cls} ${className}`}>
      {children}
    </span>
  );
}
