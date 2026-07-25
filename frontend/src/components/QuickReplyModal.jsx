import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';

const REPLY_TEMPLATES = [
  {
    label: 'Thank You + Follow-up',
    subject: 'Re: {subject}',
    body: `Hi {name},\n\nThank you for getting back to me! I'm very interested in discussing this opportunity further.\n\nI'd love to schedule a call at your convenience. I'm available Monday–Friday, 10am–6pm IST.\n\nPlease let me know a time that works for you.\n\nBest regards,\n{my_name}`,
  },
  {
    label: 'Request for Update',
    subject: 'Re: {subject}',
    body: `Hi {name},\n\nI wanted to follow up on my earlier email regarding the {role} position. I remain very enthusiastic about this opportunity and would love to learn more about the next steps.\n\nPlease let me know if you need any additional information from my end.\n\nThank you for your time!\n\nBest regards,\n{my_name}`,
  },
  {
    label: 'Interview Confirmation',
    subject: 'Re: {subject} - Interview Confirmation',
    body: `Hi {name},\n\nThank you for the interview invitation! I'm delighted to confirm my attendance.\n\nI've noted the details and will be prepared. If there's anything specific I should bring or review beforehand, please do let me know.\n\nLooking forward to speaking with you!\n\nBest regards,\n{my_name}`,
  },
  {
    label: 'Additional Info / Portfolio',
    subject: 'Re: {subject} - Additional Information',
    body: `Hi {name},\n\nThank you for your response! As requested / to supplement my application, please find below some additional information:\n\n[Add portfolio link / GitHub / LinkedIn here]\n\nI'm excited about this opportunity and confident I'd be a great fit. I'd love to connect for a quick call.\n\nBest regards,\n{my_name}`,
  },
];

function fillTemplate(text, vars) {
  return Object.entries(vars).reduce(
    (acc, [key, val]) => acc.replace(new RegExp(`\\{${key}\\}`, 'g'), val || ''),
    text
  );
}

export default function QuickReplyModal({ email, onClose, onSent, myName = '' }) {
  const [selectedTemplate, setSelectedTemplate] = useState(0);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [customized, setCustomized] = useState(false);

  const vars = {
    name:      email.contact_name?.split(' ')[0] || email.contact_email,
    subject:   email.subject || '',
    role:      '',
    my_name:   myName,
  };

  function applyTemplate(idx) {
    const tpl = REPLY_TEMPLATES[idx];
    setSelectedTemplate(idx);
    setSubject(fillTemplate(tpl.subject, vars));
    setBody(fillTemplate(tpl.body, vars));
    setCustomized(false);
  }

  // Apply first template on first render
  useState(() => { applyTemplate(0); }, []);

  async function handleSend() {
    if (!body.trim()) return toast.error('Reply body cannot be empty');
    setSending(true);
    try {
      await api.post('/gmail/reply', {
        emailId:  email.id,
        threadId: email.gmail_thread_id,
        to:       email.contact_email,
        subject:  subject || `Re: ${email.subject}`,
        body:     body.replace(/\n/g, '<br>'),
      });
      toast.success('Reply sent via Gmail!');
      onSent?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send reply');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-md shadow-modal w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Quick Reply</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              To: <span className="font-medium text-gray-700">{email.contact_name || email.contact_email}</span>
              {' · '}<span className="text-gray-500">{email.contact_email}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Template selector */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Suggested Templates</p>
            <div className="flex flex-wrap gap-2">
              {REPLY_TEMPLATES.map((tpl, idx) => (
                <button
                  key={idx}
                  onClick={() => applyTemplate(idx)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    selectedTemplate === idx && !customized
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-brand-400'
                  }`}
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>

          {/* Original email context */}
          {email.body_snippet && (
            <div className="bg-gray-50 border border-gray-200 rounded-md p-3">
              <p className="text-xs font-semibold text-gray-500 mb-1">Original Message</p>
              <p className="text-xs text-gray-600 line-clamp-3">{email.body_snippet}</p>
            </div>
          )}

          {/* Subject */}
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => { setSubject(e.target.value); setCustomized(true); }}
              className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none"
            />
          </div>

          {/* Body */}
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">Reply Body</label>
            <textarea
              rows={10}
              value={body}
              onChange={e => { setBody(e.target.value); setCustomized(true); }}
              className="w-full border border-gray-300 rounded-sm px-3 py-2 text-sm focus:ring-2 focus:ring-brand-300 outline-none resize-y font-mono"
            />
          </div>

          {/* Preview */}
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer font-medium hover:text-gray-700">Preview HTML</summary>
            <div
              className="mt-2 p-3 border rounded-sm bg-gray-50 text-sm text-gray-700 whitespace-pre-line"
              dangerouslySetInnerHTML={{ __html: body.replace(/\n/g, '<br>') }}
            />
          </details>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t bg-gray-50 rounded-b-md">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !body.trim()}
            className="px-6 py-2 bg-brand-600 text-white rounded-sm text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? 'Sending…' : '✉️ Send Reply via Gmail'}
          </button>
        </div>
      </div>
    </div>
  );
}
