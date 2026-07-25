import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';

const QUICK_QUESTIONS = [
  'How do I add a contact?',
  'How to connect Gmail?',
  'How do I send emails?',
  'What plan do I need?',
  'How to import contacts?',
  'How to use job analyzer?',
];

const WELCOME_MESSAGE = {
  id: 'welcome',
  role: 'assistant',
  content: `Hi! I'm VartaBot, your assistant for HR Outreach Tracker. 👋

I can help you:
- Navigate the app and find features
- Answer questions about plans & pricing
- Troubleshoot issues
- Give job search & outreach tips

What would you like to know?`,
  created_at: new Date().toISOString(),
};

function StarRating({ value, onChange }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(star)}
          className="text-base transition-transform hover:scale-110"
          aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
        >
          <span className={(hovered || value) >= star ? 'text-yellow-400' : 'text-gray-300'}>
            ★
          </span>
        </button>
      ))}
    </div>
  );
}

function MessageBubble({ msg, onRate, onFeedback }) {
  const [rating, setRating]       = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [showForm, setShowForm]   = useState(false);
  const [comment, setComment]     = useState('');

  const isBot = msg.role === 'assistant';

  function handleRate(star) {
    setRating(star);
    if (star >= 4) {
      onRate?.(msg.id, star, null);
      setSubmitted(true);
    } else {
      setShowForm(true);
    }
  }

  function submitFeedback() {
    onRate?.(msg.id, rating, comment.trim() || null);
    setSubmitted(true);
    setShowForm(false);
  }

  return (
    <div className={`flex ${isBot ? 'justify-start' : 'justify-end'} mb-3`}>
      <div className={`max-w-[85%] ${isBot ? '' : 'order-last'}`}>
        {isBot && (
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-5 h-5 rounded-full bg-brand-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">V</span>
            <span className="text-[10px] text-gray-400 font-medium">VartaBot</span>
          </div>
        )}
        <div
          className={`px-3 py-2 rounded-lg text-sm leading-relaxed whitespace-pre-wrap ${
            isBot
              ? 'bg-white border border-gray-200 text-gray-800 rounded-tl-none shadow-sm'
              : 'bg-brand-600 text-white rounded-tr-none'
          }`}
        >
          {msg.content}
        </div>

        {/* Rating for bot messages (not the welcome message) */}
        {isBot && msg.id !== 'welcome' && !submitted && (
          <div className="mt-1.5 ml-0.5 flex items-center gap-2">
            <span className="text-[10px] text-gray-400">Helpful?</span>
            <StarRating value={rating} onChange={handleRate} />
          </div>
        )}
        {isBot && submitted && (
          <p className="mt-1 ml-0.5 text-[10px] text-green-500">Thanks for the feedback!</p>
        )}
        {showForm && (
          <div className="mt-2 bg-gray-50 border border-gray-200 rounded-md p-2 space-y-1.5">
            <p className="text-[10px] text-gray-500">What could be improved?</p>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Tell us what went wrong..."
              className="w-full text-xs border border-gray-200 rounded p-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-brand-400"
              rows={2}
            />
            <div className="flex gap-1.5">
              <button
                onClick={submitFeedback}
                className="px-2.5 py-1 text-[10px] font-semibold bg-brand-600 text-white rounded hover:bg-brand-700 transition"
              >
                Submit
              </button>
              <button
                onClick={() => { setShowForm(false); setSubmitted(true); onRate?.(msg.id, rating, null); }}
                className="px-2.5 py-1 text-[10px] text-gray-500 hover:text-gray-700 transition"
              >
                Skip
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start mb-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-5 h-5 rounded-full bg-brand-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">V</span>
      </div>
      <div className="ml-2 px-3 py-2.5 bg-white border border-gray-200 rounded-lg rounded-tl-none shadow-sm">
        <div className="flex gap-1 items-center">
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Chatbot() {
  const { user } = useAuth();
  const [open,        setOpen]        = useState(false);
  const [messages,    setMessages]    = useState([WELCOME_MESSAGE]);
  const [input,       setInput]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [sessionId,   setSessionId]   = useState(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [unread,      setUnread]      = useState(0);
  const [error,       setError]       = useState(null);
  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);

  // Load existing chat history when opened for the first time
  useEffect(() => {
    if (open && user && !historyLoaded) {
      setHistoryLoaded(true);
      api.get('/chatbot/history').then(data => {
        if (data.messages?.length > 0) {
          setMessages([WELCOME_MESSAGE, ...data.messages]);
          setSessionId(data.sessionId);
        }
      }).catch(() => {});
    }
    if (open) {
      setUnread(0);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open, user, historyLoaded]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = useCallback(async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    setInput('');
    setError(null);
    setMessages(prev => [...prev, {
      id:         `user-${Date.now()}`,
      role:       'user',
      content:    msg,
      created_at: new Date().toISOString(),
    }]);
    setLoading(true);

    try {
      const data = await api.post('/chatbot/message', { message: msg, sessionId });
      setSessionId(data.sessionId);
      setMessages(prev => [...prev, {
        id:         data.messageId,
        role:       'assistant',
        content:    data.reply,
        created_at: new Date().toISOString(),
      }]);
      if (!open) setUnread(n => n + 1);
    } catch (e) {
      const errMsg = e?.response?.data?.error || 'Failed to get response. Please try again.';
      setError(errMsg);
      setMessages(prev => [...prev, {
        id:         `err-${Date.now()}`,
        role:       'assistant',
        content:    `Sorry, I ran into an issue: ${errMsg}`,
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, sessionId, open]);

  const handleRate = useCallback(async (messageId, rating, summary) => {
    try {
      await api.post('/chatbot/feedback', { sessionId, messageId, rating, summary });
    } catch {}
  }, [sessionId]);

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function clearChat() {
    if (sessionId) {
      api.post('/chatbot/end-session', { sessionId }).catch(() => {});
    }
    setMessages([WELCOME_MESSAGE]);
    setSessionId(null);
    setHistoryLoaded(false);
  }

  if (!user) return null;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-5 right-5 z-50 w-13 h-13 rounded-full bg-brand-600 hover:bg-brand-700 shadow-lg flex items-center justify-center transition-all hover:scale-105 active:scale-95"
        style={{ width: 52, height: 52 }}
        aria-label="Open chat assistant"
      >
        {open ? (
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread}
          </span>
        )}
      </button>

      {/* Chat window */}
      {open && (
        <div className="fixed bottom-20 right-5 z-50 w-80 sm:w-96 flex flex-col rounded-xl shadow-2xl border border-gray-200 overflow-hidden bg-white"
          style={{ height: 480 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-brand-600 text-white flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">V</span>
              <div>
                <p className="text-sm font-semibold leading-none">VartaBot</p>
                <p className="text-[10px] text-white/70 mt-0.5">Powered by Groq AI</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={clearChat}
                className="text-white/70 hover:text-white text-[10px] transition"
                title="Clear chat"
              >
                Clear
              </button>
              <button
                onClick={() => setOpen(false)}
                className="text-white/70 hover:text-white transition"
                aria-label="Close chat"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 pt-3 bg-gray-50">
            {messages.map(msg => (
              <MessageBubble key={msg.id} msg={msg} onRate={handleRate} />
            ))}
            {loading && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>

          {/* Quick questions — show when only welcome message */}
          {messages.length === 1 && (
            <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 flex flex-wrap gap-1.5 flex-shrink-0">
              {QUICK_QUESTIONS.map(q => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="text-[10px] px-2 py-1 rounded-full border border-brand-300 text-brand-700 bg-brand-50 hover:bg-brand-100 transition"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="flex-shrink-0 border-t border-gray-200 bg-white px-3 py-2.5 flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask me anything about the app..."
              className="flex-1 text-sm resize-none border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400 max-h-24 min-h-[36px]"
              rows={1}
              disabled={loading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="w-8 h-8 rounded-full bg-brand-600 hover:bg-brand-700 text-white flex items-center justify-center transition disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              aria-label="Send"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
