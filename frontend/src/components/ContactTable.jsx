import { useState, Fragment } from 'react';
import {
  ArrowUpDown, ArrowUp, ArrowDown,
  CheckCircle2, XCircle, HelpCircle, Clock, Ban, AlertTriangle, ShieldOff,
  Lock, Users,
} from 'lucide-react';
import { StatusPill, EmptyState } from './ui/index.js';
import { SkeletonRow } from './ui/Skeleton.jsx';

const STATUSES = ['New','Drafted','Sent','Opened','Replied','Interview','Rejected','Do Not Contact'];

const VERIFY_ICON = {
  valid:        <CheckCircle2 size={11} className="text-green-600 shrink-0" />,
  invalid:      <XCircle      size={11} className="text-red-500 shrink-0" />,
  unverifiable: <HelpCircle   size={11} className="text-gray-400 shrink-0" />,
};
const BOUNCE_ICON = {
  hard_bounce: <Ban           size={11} className="text-red-600 shrink-0" />,
  flagged:     <ShieldOff     size={11} className="text-red-600 shrink-0" />,
  soft_bounce: <AlertTriangle size={11} className="text-orange-500 shrink-0" />,
};

function maskEmail(email) {
  if (!email) return '';
  const atIdx = email.indexOf('@');
  if (atIdx < 0) return '•'.repeat(email.length);
  const local      = email.slice(0, atIdx);
  const domain     = email.slice(atIdx + 1);
  const dotIdx     = domain.lastIndexOf('.');
  const domainName = dotIdx >= 0 ? domain.slice(0, dotIdx) : domain;
  const tld        = dotIdx >= 0 ? domain.slice(dotIdx) : '';
  const maskedLocal  = (local[0]  || '') + '*'.repeat(Math.max(local.length  - 1, 4));
  const maskedDomain = (domainName[0] || '') + '*'.repeat(Math.max(domainName.length - 1, 3));
  return `${maskedLocal}@${maskedDomain}${tld}`;
}

function SortTh({ label, field, sortField, sortDir, onSort, className = '' }) {
  const active = sortField === field;
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      onClick={() => onSort(field)}
      className={`px-2 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:bg-gray-100 whitespace-nowrap transition-colors ${className}`}
    >
      <span className="flex items-center gap-1">
        {label}
        <Icon size={10} className={active ? 'text-brand-500' : 'text-gray-300'} />
      </span>
    </th>
  );
}

function StatusCell({ contact, onStatusChange }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <select
        autoFocus
        value={contact.status}
        onChange={e => { onStatusChange(contact.id, e.target.value); setEditing(false); }}
        onBlur={() => setEditing(false)}
        className="border border-brand-300 rounded-sm text-xs px-1.5 py-0.5 focus:ring-1 focus:ring-brand-300 outline-none bg-white"
      >
        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    );
  }
  return (
    <button onClick={() => setEditing(true)} className="hover:opacity-80 transition-opacity" title="Click to change status">
      <StatusPill status={contact.status} />
    </button>
  );
}

// Source label + confidence tooltip in one compact cell
function SourceCell({ c }) {
  const isJobIntel = c.email_source === 'job-intel';
  const label = isJobIntel ? '🟣 Job Intel'
    : (c.email_source || '').replace(/_/g, ' ') || '—';
  const confColor = c.email_confidence === 'verified' ? 'text-green-600'
    : c.email_confidence === 'guessed' ? 'text-amber-600' : 'text-gray-400';

  return (
    <div className="flex flex-col gap-0.5">
      <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded leading-tight ${
        isJobIntel ? 'bg-purple-100 text-purple-700 font-semibold' : 'bg-gray-100 text-gray-600'
      }`}>
        {label}
      </span>
      {c.email_confidence && (
        <span className={`text-[10px] leading-tight ${confColor}`}>{c.email_confidence}</span>
      )}
    </div>
  );
}

export default function ContactTable({
  contacts,
  loading,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onStatusChange,
  onSendEmail,
  isAuthenticated  = false,
  onLoginRequest   = () => {},
  visibleLimit     = 5,
  onUpgradeClick   = () => {},
  planName         = 'Guest',
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
      <div className="bg-white rounded-md shadow-card border border-gray-100 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonRow key={i} cols={9} />
        ))}
      </div>
    );
  }

  const allVisible  = contacts.length <= visibleLimit;
  const allSelected = contacts.length > 0 && selected.length === contacts.length;

  return (
    <div className="bg-white rounded-md shadow-card border border-gray-100 overflow-hidden">

      {/* Plan-limit stripe */}
      {contacts.length > 0 && (
        <div className={`border-b px-4 py-2 flex items-center justify-between gap-3 ${
          !isAuthenticated || !allVisible ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'
        }`}>
          <p className={`text-xs flex items-center gap-1.5 ${
            !isAuthenticated || !allVisible ? 'text-amber-700' : 'text-green-700'
          }`}>
            {!isAuthenticated || !allVisible
              ? <Lock size={11} className="shrink-0" />
              : <CheckCircle2 size={11} className="shrink-0" />
            }
            {!isAuthenticated
              ? <><strong>Showing 5 real emails</strong> as demo. Sign in for more.</>
              : !allVisible
                ? <><strong>{Math.min(visibleLimit, contacts.length)} of {contacts.length}</strong> contacts visible on your <strong>{planName}</strong> plan.</>
                : <>All <strong>{contacts.length}</strong> contact{contacts.length !== 1 ? 's' : ''} visible on your <strong>{planName}</strong> plan.</>
            }
          </p>
          {!isAuthenticated
            ? <button onClick={onLoginRequest}  className="text-xs font-semibold text-brand-600 hover:text-brand-800 whitespace-nowrap">Sign In →</button>
            : !allVisible
              ? <button onClick={onUpgradeClick} className="text-xs font-semibold text-violet-600 hover:text-violet-800 whitespace-nowrap">Upgrade →</button>
              : null
          }
        </div>
      )}

      <div className="overflow-x-auto">
        {/* table-fixed keeps column widths stable and prevents overflow ballooning */}
        <table className="w-full text-sm table-fixed min-w-[760px]">
          <colgroup>
            <col className="w-8" />          {/* checkbox */}
            <col className="w-[14%]" />      {/* name */}
            <col className="w-[16%]" />      {/* title */}
            <col className="w-[13%]" />      {/* company */}
            <col className="w-[18%]" />      {/* email */}
            <col className="w-[10%]" />      {/* status */}
            <col className="w-[10%]" />      {/* source */}
            <col className="w-[8%]" />       {/* added */}
            <col className="w-[11%]" />      {/* actions */}
          </colgroup>

          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-2 py-2.5 w-8">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 accent-teal-600"
                  checked={allSelected}
                  onChange={e => onSelect(e.target.checked ? contacts.map(c => c.id) : [])}
                />
              </th>
              <SortTh label="Name"    field="name"         sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Job Title" field="title"      sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Company" field="company"      sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Email"   field="email"        sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Status"  field="status"       sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Source"  field="email_source" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortTh label="Added"   field="date_added"   sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <th className="px-2 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <EmptyState
                    icon={<Users size={20} strokeWidth={1.5} />}
                    title="Abhi tak jawaab nahi aaya — par agla email hi ho sakta hai woh wala."
                    description="Add a contact manually or import a CSV / Excel file to start tracking."
                    className="py-12"
                  />
                </td>
              </tr>
            )}

            {sorted.map((c, idx) => {
              const emailVisible   = idx < visibleLimit;
              const isDoNotContact = c.status === 'Do Not Contact';
              const isJobIntel     = c.email_source === 'job-intel';

              return (
                <Fragment key={c.id}>
                  {idx === visibleLimit && (
                    <tr className="border-y-2 border-amber-300">
                      <td colSpan={9} className="bg-amber-50 px-4 py-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-amber-800 font-medium flex items-center gap-1.5">
                            <Lock size={11} className="text-amber-600 shrink-0" />
                            You've reached the <strong>{planName} plan</strong> limit ({visibleLimit} visible).{' '}
                            {sorted.length - visibleLimit} more contact{sorted.length - visibleLimit !== 1 ? 's' : ''} below are locked.
                          </p>
                          <button
                            onClick={isAuthenticated ? onUpgradeClick : onLoginRequest}
                            className="text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 px-3 py-1.5 rounded-sm whitespace-nowrap transition"
                          >
                            {isAuthenticated ? 'Upgrade Plan' : 'Sign In / Upgrade'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}

                  <tr className={`${
                    !emailVisible ? 'bg-gray-50/30 opacity-70'
                    : isDoNotContact ? 'opacity-50 bg-white'
                    : isJobIntel ? 'bg-purple-50/40 border-l-2 border-l-purple-400'
                    : 'bg-white'
                  } hover:bg-stone-50/60 transition-colors`}>

                    {/* Checkbox */}
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 accent-teal-600"
                        checked={selected.includes(c.id)}
                        onChange={() => onSelect(prev =>
                          prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id]
                        )}
                      />
                    </td>

                    {/* Name */}
                    <td className="px-2 py-2 font-medium text-gray-900 truncate" title={c.name}>
                      {c.name}
                    </td>

                    {/* Job Title */}
                    <td className="px-2 py-2 text-gray-600 truncate" title={c.title || ''}>
                      {c.title
                        ? <span className="text-xs">{c.title}</span>
                        : <span className="text-gray-300 text-xs">—</span>
                      }
                    </td>

                    {/* Company */}
                    <td className="px-2 py-2 text-gray-700 truncate text-xs" title={c.company || ''}>
                      {c.company || <span className="text-gray-300">—</span>}
                    </td>

                    {/* Email */}
                    <td className="px-2 py-2 truncate">
                      {emailVisible ? (
                        <span className="inline-flex items-center gap-1 min-w-0">
                          <a
                            href={`mailto:${c.email}`}
                            className="text-brand-600 hover:text-brand-800 hover:underline transition-colors text-xs truncate"
                            title={c.email}
                          >
                            {c.email}
                          </a>
                          <span className="shrink-0 flex items-center gap-0.5">
                            {VERIFY_ICON[c.email_verified]}
                            {(!c.email_verified || c.email_verified === 'pending') && (
                              <Clock size={11} className="text-amber-500" title="Verification pending" />
                            )}
                            {BOUNCE_ICON[c.email_deliverable]}
                          </span>
                        </span>
                      ) : (
                        <button
                          onClick={isAuthenticated ? onUpgradeClick : onLoginRequest}
                          className="flex items-center gap-1 text-gray-400 hover:text-violet-600 group transition-colors"
                          title={isAuthenticated ? 'Upgrade to view email' : 'Sign in to view email'}
                        >
                          <span className="font-mono text-xs tracking-tight">{maskEmail(c.email)}</span>
                          <Lock size={10} className="opacity-60 group-hover:opacity-100 shrink-0" />
                        </button>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-2 py-2">
                      <StatusCell contact={c} onStatusChange={onStatusChange} />
                    </td>

                    {/* Source + Confidence (merged) */}
                    <td className="px-2 py-2">
                      <SourceCell c={c} />
                    </td>

                    {/* Added */}
                    <td className="px-2 py-2 text-[11px] text-gray-400 whitespace-nowrap">
                      {c.date_added ? new Date(c.date_added).toLocaleDateString('en-IN') : '—'}
                    </td>

                    {/* Actions */}
                    <td className="px-2 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {c.status !== 'Do Not Contact' && (
                          emailVisible && isAuthenticated && onSendEmail ? (
                            <button
                              onClick={() => onSendEmail(c)}
                              className="text-xs text-emerald-600 hover:text-emerald-800 font-medium transition-colors"
                            >
                              Send
                            </button>
                          ) : (
                            <button
                              onClick={isAuthenticated ? onUpgradeClick : onLoginRequest}
                              className="text-xs text-gray-300 hover:text-violet-500 font-medium flex items-center gap-0.5 transition-colors"
                              title={isAuthenticated ? 'Upgrade to send' : 'Sign in to send'}
                            >
                              <Lock size={10} /> Send
                            </button>
                          )
                        )}
                        <button onClick={() => onEdit(c)}
                          className="text-xs text-brand-600 hover:text-brand-800 font-medium transition-colors">
                          Edit
                        </button>
                        <button onClick={() => onDelete(c.id)}
                          className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors">
                          Del
                        </button>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {contacts.length > 0 && (
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
          {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
          {selected.length > 0 && (
            <span className="ml-2 text-brand-600 font-medium">· {selected.length} selected</span>
          )}
        </div>
      )}
    </div>
  );
}
