/**
 * Multi-select filter dropdown — closed by default, showing a compact
 * "N selected" trigger button instead of a native <select multiple> listbox
 * (which renders every option as an always-visible text list). Opens a
 * checkbox popover on click, closes on outside-click or Escape.
 */
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export default function MultiSelectDropdown({
  options,           // [{ value, label }]
  selected,           // array of selected values
  onChange,           // (nextSelectedArray) => void
  placeholder = 'All',
  className = '',
  title = '',
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEscape  = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  const toggle = (value) => {
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]);
  };

  const label = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? options.find(o => o.value === selected[0])?.label ?? selected[0]
      : `${selected.length} selected`;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        title={title}
        onClick={() => setOpen(o => !o)}
        className={`border rounded-sm px-3 py-2 text-sm outline-none bg-white flex items-center gap-1.5 whitespace-nowrap transition-colors ${
          selected.length ? 'border-brand-300 text-brand-700 bg-brand-50' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
        }`}
      >
        {label}
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 min-w-[14rem] max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg py-1 animate-modal-in">
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 border-b border-gray-100 mb-1"
            >
              Clear selection
            </button>
          )}
          {options.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400">No options</div>
          )}
          {options.map(o => {
            const checked = selected.includes(o.value);
            return (
              <label
                key={o.value}
                className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer"
              >
                <span className={`w-4 h-4 rounded-sm border flex items-center justify-center flex-shrink-0 ${
                  checked ? 'bg-brand-600 border-brand-600' : 'border-gray-300'
                }`}>
                  {checked && <Check size={11} className="text-white" strokeWidth={3} />}
                </span>
                <input type="checkbox" className="hidden" checked={checked} onChange={() => toggle(o.value)} />
                <span className="truncate">{o.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
