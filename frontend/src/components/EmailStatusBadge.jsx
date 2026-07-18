import React from 'react';

const STATUS_CONFIG = {
  sent:        { color: 'bg-blue-100 text-blue-800 border-blue-300',    icon: '📤', label: 'Sent'        },
  delivered:   { color: 'bg-green-100 text-green-800 border-green-300',  icon: '✅', label: 'Delivered'   },
  undelivered: { color: 'bg-orange-100 text-orange-800 border-orange-300',icon: '⚠️', label: 'Undelivered' },
  failed:      { color: 'bg-red-100 text-red-800 border-red-300',        icon: '❌', label: 'Failed'      },
  replied:     { color: 'bg-purple-100 text-purple-800 border-purple-300',icon: '💬', label: 'Replied'    },
  opened:      { color: 'bg-yellow-100 text-yellow-800 border-yellow-300',icon: '👁️', label: 'Opened'     },
  // Contact statuses
  New:          { color: 'bg-gray-100 text-gray-700 border-gray-300',    icon: '🆕', label: 'New'         },
  Drafted:      { color: 'bg-indigo-100 text-indigo-800 border-indigo-300',icon: '✏️', label: 'Drafted'   },
  Sent:         { color: 'bg-blue-100 text-blue-800 border-blue-300',    icon: '📤', label: 'Sent'        },
  Opened:       { color: 'bg-yellow-100 text-yellow-800 border-yellow-300',icon: '👁️', label: 'Opened'    },
  Replied:      { color: 'bg-purple-100 text-purple-800 border-purple-300',icon: '💬', label: 'Replied'   },
  Interview:    { color: 'bg-green-100 text-green-800 border-green-300',  icon: '🎯', label: 'Interview'  },
  Rejected:     { color: 'bg-red-100 text-red-800 border-red-300',        icon: '🚫', label: 'Rejected'   },
  'Do Not Contact': { color: 'bg-gray-200 text-gray-500 border-gray-400', icon: '🔕', label: 'Do Not Contact' },
};

export default function EmailStatusBadge({ status, size = 'sm', showFlag = false }) {
  const cfg  = STATUS_CONFIG[status] || STATUS_CONFIG.sent;
  const text = size === 'xs' ? 'text-xs' : 'text-xs';
  const pad  = size === 'xs' ? 'px-1.5 py-0.5' : 'px-2 py-0.5';

  return (
    <span className={`inline-flex items-center gap-1 ${pad} rounded-full border font-semibold ${text} ${cfg.color}`}>
      <span>{cfg.icon}</span>
      <span>{cfg.label}</span>
      {showFlag && (status === 'replied' || status === 'Replied') && (
        <span className="ml-0.5 text-purple-600">🚩</span>
      )}
    </span>
  );
}
