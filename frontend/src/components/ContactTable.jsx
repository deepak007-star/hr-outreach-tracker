import { useState } from 'react';

const STATUSES = ['New','Drafted','Sent','Opened','Replied','Interview','Rejected','Do Not Contact'];

const ROW_BG = {
  'New':            'bg-white',
  'Drafted':        'bg-blue-50',
  'Sent':           'bg-yellow-50',
  'Opened':         'bg-lime-50',
  'Replied':        'bg-green-50',
  'Interview':      'bg-emerald-50',
  'Rejected':       'bg-red-50',
  'Do Not Contact': 'bg-gray-700',
};

const ROW_TEXT_OVERRIDE = {
  'Do Not Contact': 'text-gray-400 line-through',
};

// v*****@g****.com  — shows only first char of local + domain
function maskEmail(email) {
  if (!email) return '';
  const atIdx = email.indexOf('@');
  if (atIdx < 0) return '•'.repeat(email.length);
  const local  = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  const dotIdx = domain.lastIndexOf('.');
  const domainName = dotIdx >= 0 ? domain.slice(0, dotIdx) : domain;
  const tld        = dotIdx >= 0 ? domain.slice(dotIdx) : '';
  const maskedLocal  = (local[0]  || '') + '*'.repeat(Math.max(local.length  - 1, 4));
  const maskedDomain = (domainName[0] || '') + '*'.repeat(Math.max(domainName.length - 1, 3));
  return `${maskedLocal}@${maskedDomain}${tld}`;
}

function SortTh({ label, field, sortField, sortDir, onSort }) {
  const active = sortField === field;
  return (
    <th
      onClick={() => onSort(field)}
      className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:bg-gray-100 whitespace-nowrap"
    >
      {label}
      <span className={`ml-1 ${active ? 'text-blue-500' : 'text-gray-300'}`}>
        {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </th>
  );
}

export default function ContactTable({
  contacts, loading, selected, onSelect,
  onEdit, onDelete, onStatusChange, onSendEmail,
  isAuthenticated = false,
  onLoginRequest  = () => {},
  visibleLimit    = 5,       // how many rows get full email + send access
  onUpgradeClick  = () => {},
  planName        = 'Guest',
}) {
  const [sortField, setSortField] = useState('date_added');
  const [sortDir,   setSortDir]   = useState('desc');

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const sorted = [...contacts].sort((a, b) => {
    const av = a[sortField] || '';
    const bv = b[sortField] || '';
    return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  if (loading) {
    return (
      <div className="bg-white rounded-xl border shadow-sm flex items-center justify-center h-48">
        <p className="text-gray-400 text-sm animate-pulse">Loading contacts…</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">

      {/* Banner: plan limit info */}
      {contacts.length > 0 && (
        <div className={`border-b px-4 py-2.5 flex items-center justify-between ${
          !isAuthenticated
            ? 'bg-amber-50 border-amber-200'
            : contacts.length > visibleLimit
              ? 'bg-amber-50 border-amber-200'
              : 'bg-green-50 border-green-200'
        }`}>
          <p className={`text-xs ${
            !isAuthenticated || contacts.length > visibleLimit ? 'text-amber-700' : 'text-green-700'
          }`}>
            {!isAuthenticated
              ? <>🔒 <strong>Showing 5 real emails</strong> as demo. Sign in for more.</>
              : contacts.length > visibleLimit
                ? <>🔒 <strong>{Math.min(visibleLimit, contacts.length)} of {contacts.length}</strong> contacts visible on your <strong>{planName}</strong> plan.</>
                : <>✅ All <strong>{contacts.length}</strong> contact{contacts.length !== 1 ? 's' : ''} visible on your <strong>{planName}</strong> plan.</>
            }
          </p>
          <div className="flex items-center gap-3 ml-4">
            {!isAuthenticated
              ? <button onClick={onLoginRequest}  className="text-xs font-semibold text-blue-600 hover:underline whitespace-nowrap">Sign In →</button>
              : contacts.length > visibleLimit
                ? <button onClick={onUpgradeClick} className="text-xs font-semibold text-purple-600 hover:underline whitespace-nowrap">↑ Upgrade →</button>
                : null
            }
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-3 py-3 w-8">
                <input
                  type="checkbox"
                  className="rounded border-gray-300"
                  checked={contacts.length > 0 && selected.length === contacts.length}
                  onChange={e => onSelect(e.target.checked ? contacts.map(c => c.id) : [])}
                />
              </th>
              <SortTh label="Name"        field="name"             sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Title"       field="title"            sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Company"     field="company"          sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Email"       field="email"            sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Status"      field="status"           sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Source"      field="email_source"     sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Confidence"  field="email_confidence" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Date Added"  field="date_added"       sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <th className="px-3 py-3 text-xs text-gray-400 uppercase">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center py-20 text-gray-400 text-sm">
                  No contacts yet — add one or import a CSV/Excel file.
                </td>
              </tr>
            )}

            {sorted.map((c, idx) => {
              const rowBg      = ROW_BG[c.status] || 'bg-white';
              const textCls    = ROW_TEXT_OVERRIDE[c.status] || '';
              const emailVisible = idx < visibleLimit; // within this user's plan limit

              return (
                <>
                {/* Upgrade divider — injected once right at the limit boundary */}
                {idx === visibleLimit && (
                  <tr key={`__divider__`} className="border-y-2 border-amber-300">
                    <td colSpan={10} className="bg-amber-50 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-amber-800 font-medium">
                          🔒 You've reached the <strong>{planName} plan</strong> limit ({visibleLimit} contacts visible). {sorted.length - visibleLimit} more contact{sorted.length - visibleLimit !== 1 ? 's' : ''} below are locked.
                        </p>
                        <button
                          onClick={isAuthenticated ? onUpgradeClick : onLoginRequest}
                          className="text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 px-3 py-1.5 rounded-lg whitespace-nowrap transition"
                        >
                          {isAuthenticated ? '↑ Upgrade Plan' : 'Sign In / Upgrade'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                <tr key={c.id} className={`${emailVisible ? rowBg : 'bg-gray-50 opacity-80'} hover:brightness-[0.97] transition-all`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      checked={selected.includes(c.id)}
                      onChange={() => onSelect(prev =>
                        prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id]
                      )}
                    />
                  </td>
                  <td className={`px-3 py-2 font-medium whitespace-nowrap ${textCls}`}>{c.name}</td>
                  <td className={`px-3 py-2 text-gray-600 whitespace-nowrap ${textCls}`}>{c.title || <span className="text-gray-300">—</span>}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${textCls}`}>{c.company || <span className="text-gray-300">—</span>}</td>

                  {/* Email — masked beyond plan limit */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {emailVisible ? (
                      <span className="inline-flex items-center gap-1.5">
                        <a href={`mailto:${c.email}`} className={`text-blue-600 hover:underline ${textCls}`}>
                          {c.email}
                        </a>
                        {c.email_verified === 'valid'        && <span title="Email domain verified (MX record found)"    className="text-green-600 text-xs">✓</span>}
                        {c.email_verified === 'invalid'      && <span title="Email domain invalid (no MX record)"        className="text-red-500  text-xs">✗</span>}
                        {c.email_verified === 'unverifiable' && <span title="Could not verify (DNS timeout or protected)" className="text-gray-400 text-xs">?</span>}
                        {(!c.email_verified || c.email_verified === 'pending') && <span title="Verification pending" className="text-yellow-500 text-xs">⏳</span>}
                      </span>
                    ) : (
                      <button
                        onClick={isAuthenticated ? onUpgradeClick : onLoginRequest}
                        className="flex items-center gap-1.5 text-gray-400 hover:text-purple-600 group"
                        title={isAuthenticated ? 'Upgrade to view email' : 'Sign in to view email'}
                      >
                        <span className="font-mono text-xs tracking-tight">{maskEmail(c.email)}</span>
                        <span className="text-xs opacity-0 group-hover:opacity-100 transition-opacity">🔒</span>
                      </button>
                    )}
                  </td>

                  <td className="px-3 py-2">
                    <select
                      value={c.status}
                      onChange={e => onStatusChange(c.id, e.target.value)}
                      className="border-0 bg-transparent text-xs p-0 pr-5 cursor-pointer focus:ring-0 outline-none"
                    >
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>

                  <td className={`px-3 py-2 text-xs text-gray-500 capitalize whitespace-nowrap ${textCls}`}>
                    {c.email_source?.replace(/_/g, ' ')}
                  </td>
                  <td className={`px-3 py-2 text-xs whitespace-nowrap ${textCls} ${
                    c.email_confidence === 'verified' ? 'text-green-600' :
                    c.email_confidence === 'guessed'  ? 'text-yellow-600' : 'text-gray-400'
                  }`}>
                    {c.email_confidence}
                  </td>
                  <td className={`px-3 py-2 text-xs text-gray-400 whitespace-nowrap ${textCls}`}>
                    {c.date_added ? new Date(c.date_added).toLocaleDateString('en-IN') : '—'}
                  </td>

                  {/* Actions — Send gated by plan limit */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      {c.status !== 'Do Not Contact' && (
                        emailVisible && isAuthenticated && onSendEmail ? (
                          <button
                            onClick={() => onSendEmail(c)}
                            className="text-xs text-green-600 hover:text-green-800 font-medium"
                          >
                            Send
                          </button>
                        ) : (
                          <button
                            onClick={isAuthenticated ? onUpgradeClick : onLoginRequest}
                            className="text-xs text-gray-300 hover:text-purple-500 font-medium"
                            title={isAuthenticated ? 'Upgrade to send' : 'Sign in to send'}
                          >
                            🔒 Send
                          </button>
                        )
                      )}
                      <button onClick={() => onEdit(c)}   className="text-xs text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                      <button onClick={() => onDelete(c.id)} className="text-xs text-red-500 hover:text-red-700 font-medium">Delete</button>
                    </div>
                  </td>
                </tr>
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {contacts.length > 0 && (
        <div className="px-4 py-2 bg-gray-50 border-t text-xs text-gray-400">
          {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
          {selected.length > 0 && <span className="ml-2 text-blue-600 font-medium">· {selected.length} selected</span>}
        </div>
      )}
    </div>
  );
}
