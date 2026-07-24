/**
 * Shared Tabs — single visual style (underline pill).
 * Used for: Contacts sub-tabs, Profile sub-tabs, Admin sub-tabs,
 * Templates sub-tabs. Never build a second tab style.
 *
 * Usage:
 *   <Tabs tabs={[{ id, label, icon? }]} active={activeId} onChange={setActive} />
 */
export default function Tabs({ tabs, active, onChange, className = '' }) {
  return (
    <div className={`flex gap-0 border-b border-gray-200 overflow-x-auto ${className}`}>
      {tabs.map(tab => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors duration-150 -mb-px ${
              isActive
                ? 'border-brand-600 text-brand-700 bg-brand-50/60'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50/60'
            }`}
          >
            {tab.icon && <span className="w-4 h-4 opacity-80">{tab.icon}</span>}
            {tab.label}
            {tab.count != null && (
              <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                isActive ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
