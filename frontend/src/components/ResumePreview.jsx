/**
 * Visual resume renderer — renders a resume text (possibly with [ADDED] / [ADDED-LINE] markers)
 * with proper formatting: bold centered name, section headers with underline, bold sub-category
 * labels, indented bullets, and body text.
 *
 * [ADDED-LINE]text  → whole new line (green left border + background)
 * text[ADDED]skill  → inline addition (green chip)
 */

function classifyLine(rawLine) {
  const isAddedLine = rawLine.startsWith('[ADDED-LINE]');
  const line = isAddedLine ? rawLine.slice('[ADDED-LINE]'.length) : rawLine;
  const t = line.trim();

  if (!t) return { type: 'blank', line, isAddedLine };

  // ALL-CAPS section header (no colon, not too long)
  if (
    t.length > 2 &&
    t === t.toUpperCase() &&
    /^[A-Z]/.test(t) &&
    !t.includes(':') &&
    t.length < 80
  ) return { type: 'section', line, isAddedLine };

  // "Label: content" sub-category
  const colonIdx = t.indexOf(':');
  if (
    colonIdx > 0 &&
    colonIdx < 35 &&
    /^[A-Za-z][A-Za-z\s\/&0-9]+$/.test(t.slice(0, colonIdx)) &&
    t.slice(colonIdx + 1).trim().length > 0
  ) return { type: 'subcategory', line, isAddedLine, label: t.slice(0, colonIdx + 1), rest: t.slice(colonIdx + 1) };

  // Bullet
  if (/^[•▪▸►\-–]\s/.test(t)) return { type: 'bullet', line, isAddedLine };

  return { type: 'body', line, isAddedLine };
}

function renderInlineAdded(text, baseClass = '') {
  if (!text.includes('[ADDED]')) {
    return <span className={baseClass}>{text}</span>;
  }
  const parts = text.split('[ADDED]');
  return (
    <>
      <span className={baseClass}>{parts[0]}</span>
      {parts.slice(1).map((part, j) => (
        <span
          key={j}
          className="bg-green-100 text-green-800 font-semibold rounded px-0.5 mx-0.5 text-[0.7rem]"
        >
          +{part}
        </span>
      ))}
    </>
  );
}

export default function ResumePreview({ text, maxH = '96' }) {
  if (!text) return null;

  const rawLines = text.split('\n');

  // First non-blank line is the name
  const firstNonBlankIdx = rawLines.findIndex(l => l.trim());

  return (
    <div
      className={`bg-white border border-gray-200 rounded-lg shadow-sm overflow-y-auto max-h-${maxH} p-6 text-sm leading-relaxed`}
      style={{ fontFamily: 'Calibri, Georgia, serif' }}
    >
      {rawLines.map((rawLine, i) => {
        // Name line (first non-blank, not an ALL-CAPS section)
        if (i === firstNonBlankIdx) {
          const t = rawLine.trim();
          return (
            <div key={i} className="text-center mb-2">
              <p className="text-xl font-bold text-gray-900 tracking-wide">
                {renderInlineAdded(t.replace(/\[ADDED-LINE\]/g, ''))}
              </p>
            </div>
          );
        }

        const { type, line, isAddedLine, label, rest } = classifyLine(rawLine);
        const t = line.trim();

        const addedLineWrap = (child) =>
          isAddedLine ? (
            <div className="border-l-2 border-green-400 bg-green-50 pl-2 my-0.5 rounded-r">
              {child}
            </div>
          ) : child;

        switch (type) {
          case 'blank':
            return <div key={i} className="h-2" />;

          case 'section':
            return (
              <div key={i} className="mt-3 mb-1">
                <p className="text-xs font-bold text-gray-800 uppercase tracking-widest border-b border-gray-300 pb-0.5">
                  {renderInlineAdded(t)}
                </p>
              </div>
            );

          case 'subcategory':
            return addedLineWrap(
              <p key={i} className="text-xs my-0.5">
                <span className="font-semibold text-gray-800">{label}</span>
                {renderInlineAdded(rest, 'text-gray-700')}
              </p>
            );

          case 'bullet':
            return addedLineWrap(
              <p key={i} className="text-xs text-gray-700 pl-4 my-0.5">
                {renderInlineAdded(t)}
              </p>
            );

          default: // body
            return addedLineWrap(
              <p key={i} className="text-xs text-gray-700 my-0.5">
                {renderInlineAdded(t)}
              </p>
            );
        }
      })}
    </div>
  );
}
