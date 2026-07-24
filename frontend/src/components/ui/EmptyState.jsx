/**
 * EmptyState — shared empty/zero-data state.
 * Voice: "The Signal" — warm, not corporate.
 * Used in: Resume Vault, Bulk Apply, Contacts filtered, Referrals, etc.
 *
 * Props:
 *   icon       — lucide-react icon element (optional, defaults to signal icon)
 *   title      — short headline (e.g. "No signal yet")
 *   description — one line of context
 *   action     — { label, onClick } for the primary CTA button
 *   secondaryAction — { label, onClick } for a ghost secondary
 */
import Button from './Button.jsx';
import { Radio } from 'lucide-react';

export default function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className = '',
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-16 px-6 ${className}`}>
      <div className="mb-4 w-12 h-12 rounded-md bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600">
        {icon ?? <Radio size={24} strokeWidth={1.5} />}
      </div>
      <p className="text-sm font-semibold text-gray-800 mb-1">{title ?? 'No signal yet'}</p>
      {description && (
        <p className="text-sm text-gray-400 max-w-xs leading-relaxed mb-5">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-3">
          {action && (
            <Button variant="primary" size="md" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="ghost" size="md" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
