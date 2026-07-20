import { forwardRef, useRef, useEffect, useImperativeHandle } from 'react';

const FONTS = [
  { label: 'Arial',            value: 'Arial, sans-serif' },
  { label: 'Times New Roman',  value: '"Times New Roman", serif' },
  { label: 'Georgia',          value: 'Georgia, serif' },
  { label: 'Calibri',          value: 'Calibri, sans-serif' },
  { label: 'Courier New',      value: '"Courier New", monospace' },
];

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Convert plain text to editor HTML (skips if already HTML). */
export function toHtml(text) {
  if (!text) return '';
  if (/<[a-zA-Z]/.test(text)) return text;
  return text.split('\n').map(l => `<div>${l === '' ? '<br>' : escapeHtml(l)}</div>`).join('');
}

/**
 * Rich text editor backed by a contentEditable div.
 *
 * Props:
 *   value      — HTML or plain-text string (plain-text auto-converted to HTML)
 *   onChange   — called with the current innerHTML on every edit
 *   disabled   — renders a read-only styled div when true
 *   minRows    — approx minimum height in text rows (default 13)
 *
 * Ref API (via useImperativeHandle):
 *   insertText(text) — inserts text at the current cursor position
 */
const RichEditor = forwardRef(function RichEditor(
  { value = '', onChange, disabled = false, minRows = 13 },
  ref,
) {
  const editorRef  = useRef(null);
  const extValue   = useRef(null); // last value we pushed into DOM
  const savedRange = useRef(null); // last known selection inside editor

  // Save cursor position whenever selection changes inside the editor
  useEffect(() => {
    function onSelChange() {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
        savedRange.current = sel.getRangeAt(0).cloneRange();
      }
    }
    document.addEventListener('selectionchange', onSelChange);
    return () => document.removeEventListener('selectionchange', onSelChange);
  }, []);

  // Sync external value → DOM (only when value changes from the outside)
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (extValue.current !== value) {
      extValue.current = value;
      el.innerHTML = toHtml(value);
    }
  }, [value]);

  function flush() {
    const html = editorRef.current?.innerHTML ?? '';
    extValue.current = html; // mark as self-produced so effect won't re-set
    onChange(html);
  }

  /** Execute a formatting command and flush the result. */
  function exec(cmd, arg) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, arg ?? null);
    flush();
  }

  /** Restore saved cursor position then execute a command (for toolbar selects). */
  function execSaved(cmd, arg) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    if (savedRange.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRange.current);
    }
    document.execCommand(cmd, false, arg ?? null);
    flush();
  }

  // Imperative handle exposed to parent via ref
  useImperativeHandle(ref, () => ({
    insertText(text) {
      const el = editorRef.current;
      if (!el || disabled) return;
      el.focus();
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.setEndAfter(node);
        sel.removeAllRanges();
        sel.addRange(range);
      } else if (savedRange.current && el.contains(savedRange.current.commonAncestorContainer)) {
        const range = savedRange.current;
        sel?.removeAllRanges();
        sel?.addRange(range);
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.setEndAfter(node);
        sel?.removeAllRanges();
        sel?.addRange(range);
      } else {
        document.execCommand('insertText', false, text);
      }
      flush();
    },
  }));

  if (disabled) {
    return (
      <div
        className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700 leading-relaxed overflow-auto"
        style={{ minHeight: `${minRows * 22}px`, wordBreak: 'break-word' }}
        dangerouslySetInnerHTML={{ __html: toHtml(value) }}
      />
    );
  }

  const Btn = ({ title, onMD, children, extraCls = '' }) => (
    <button
      type="button"
      title={title}
      onMouseDown={e => { e.preventDefault(); onMD(); }}
      className={`px-2 py-0.5 text-xs rounded text-gray-700 hover:bg-gray-200 transition ${extraCls}`}
    >
      {children}
    </button>
  );

  return (
    <div className="border rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-300">
      {/* Toolbar */}
      <div className="flex items-center gap-1 flex-wrap border-b px-2 py-1.5 bg-gray-50">
        <Btn title="Bold"      onMD={() => exec('bold')}      extraCls="font-bold">B</Btn>
        <Btn title="Italic"    onMD={() => exec('italic')}    extraCls="italic">I</Btn>
        <Btn title="Underline" onMD={() => exec('underline')} extraCls="underline">U</Btn>

        <div className="w-px h-4 bg-gray-300 mx-0.5" />

        <select
          defaultValue=""
          onChange={e => { const v = e.target.value; e.target.value = ''; if (v) execSaved('fontName', v); }}
          className="text-xs border rounded px-1.5 py-0.5 bg-white text-gray-700 focus:outline-none cursor-pointer"
          title="Font family"
        >
          <option value="" disabled>Font…</option>
          {FONTS.map(f => <option key={f.label} value={f.value}>{f.label}</option>)}
        </select>

        <select
          defaultValue=""
          onChange={e => { const v = e.target.value; e.target.value = ''; if (v) execSaved('fontSize', v); }}
          className="text-xs border rounded px-1.5 py-0.5 bg-white text-gray-700 focus:outline-none cursor-pointer"
          title="Font size"
        >
          <option value="" disabled>Size…</option>
          <option value="1">Tiny</option>
          <option value="2">Small</option>
          <option value="3">Normal</option>
          <option value="4">Large</option>
          <option value="5">XL</option>
        </select>

        <div className="w-px h-4 bg-gray-300 mx-0.5" />

        <Btn title="Bullet list"       onMD={() => exec('insertUnorderedList')}>• List</Btn>
        <Btn title="Clear formatting"  onMD={() => exec('removeFormat')} extraCls="text-gray-400">Aa</Btn>
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={flush}
        onKeyDown={e => {
          if (e.key === 'Tab') { e.preventDefault(); exec('insertText', '  '); }
        }}
        className="px-3 py-2 text-sm outline-none"
        style={{ minHeight: `${minRows * 22}px`, lineHeight: '1.7', wordBreak: 'break-word' }}
      />
    </div>
  );
});

export default RichEditor;
