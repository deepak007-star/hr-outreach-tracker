import { useState } from 'react';

const SOURCE_COLORS = {
  linkedin:    'bg-blue-100   text-blue-800',
  naukri:      'bg-orange-100 text-orange-800',
  internshala: 'bg-green-100  text-green-800',
  arbeitnow:   'bg-indigo-100 text-indigo-800',
  remoteok:    'bg-teal-100   text-teal-800',
  'linkedin-feed': 'bg-purple-100 text-purple-800',
};

function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }); }
  catch { return d.slice(0, 10); }
}

export default function JobCard({ job }) {
  const srcColor = SOURCE_COLORS[job.scraper_type] || 'bg-gray-100 text-gray-700';
  const isRemote = job.is_remote === 1 || job.is_remote === true;
  const [expanded, setExpanded] = useState(false);
  const LONG_DESC = job.description && job.description.length > 200;

  function openLink(url) {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="bg-white border rounded-md p-4 flex flex-col gap-3 hover:shadow-md hover:border-brand-300 transition-all group">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <button
            onClick={() => openLink(job.link || job.apply_link)}
            className="font-bold text-sm text-gray-900 hover:text-brand-600 text-left truncate block w-full transition-colors"
            title={job.title}
          >
            {job.title || 'Untitled Job'}
          </button>
          <p className="text-xs font-semibold text-gray-600 mt-0.5 truncate">{job.company || 'Unknown Company'}</p>
        </div>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 uppercase ${srcColor}`}>
          {job.scraper_type || 'job'}
        </span>
      </div>

      {/* Meta chips */}
      <div className="flex flex-wrap gap-1.5">
        {job.location && (
          <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full border">
            {isRemote ? '🌐' : '📍'} {job.location}
          </span>
        )}
        {job.salary && (
          <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full border border-green-200">
            💰 {job.salary}
          </span>
        )}
        {job.experience && (
          <span className="inline-flex items-center gap-1 text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full border border-purple-200">
            🧑‍💼 {job.experience}
          </span>
        )}
        {job.job_type && (
          <span className="inline-flex items-center gap-1 text-xs bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full border border-yellow-200">
            {job.job_type}
          </span>
        )}
      </div>

      {/* Description */}
      {job.description && (
        <div>
          <p className={`text-xs text-gray-500 leading-relaxed whitespace-pre-line ${expanded ? '' : 'line-clamp-2'}`}>
            {job.description}
          </p>
          {LONG_DESC && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xs text-brand-500 hover:text-brand-700 mt-0.5"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}

      {/* HR Contact info (LinkedIn Feed jobs) */}
      {(job.contact_email || job.contact_phone || job.google_form_link || job.whatsapp_link) && (
        <div className="bg-green-50 border border-green-200 rounded-sm p-2.5 flex flex-wrap gap-2">
          {job.contact_email && (
            <a href={`mailto:${job.contact_email}`} className="text-xs text-green-700 font-medium hover:underline">
              ✉️ {job.contact_email}
            </a>
          )}
          {job.contact_phone && (
            <span className="text-xs text-green-700">📞 {job.contact_phone}</span>
          )}
          {job.google_form_link && (
            <button onClick={() => openLink(job.google_form_link)} className="text-xs text-blue-600 hover:underline">
              📋 Google Form
            </button>
          )}
          {job.whatsapp_link && (
            <button onClick={() => openLink(job.whatsapp_link)} className="text-xs text-green-600 hover:underline">
              💬 WhatsApp
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-100">
        <span className="text-xs text-gray-400">
          {job.posted_at ? `Posted ${fmtDate(job.posted_at)}` : `Added ${fmtDate(job.created_at)}`}
        </span>
        <div className="flex gap-1.5">
          {job.link && job.link !== job.apply_link && (
            <button
              onClick={() => openLink(job.link)}
              className="px-3 py-1 text-xs border border-gray-300 text-gray-600 rounded-sm hover:bg-gray-50 font-medium transition-colors"
            >
              View
            </button>
          )}
          <button
            onClick={() => openLink(job.apply_link || job.link)}
            className="px-3 py-1 text-xs bg-brand-600 text-white rounded-sm hover:bg-brand-700 font-semibold transition-colors"
          >
            {job.apply_link ? 'Apply →' : 'View →'}
          </button>
        </div>
      </div>
    </div>
  );
}
