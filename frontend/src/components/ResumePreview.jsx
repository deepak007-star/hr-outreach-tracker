/**
 * Renders a modified resume with inline [ADDED]skill and [ADDED-LINE]text markers.
 *
 * [ADDED-LINE]text  → entire line is newly inserted (green bg)
 * text[ADDED]skill  → skill appended inline to an existing line (green inline chip)
 */
export default function ResumePreview({ text, maxH = '96' }) {
  if (!text) return null;

  const lines = text.split('\n');

  return (
    <div className={`text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-${maxH} overflow-y-auto border rounded-lg bg-gray-50 p-3`}>
      {lines.map((line, i) => {
        // ── Entirely new line ──────────────────────────────────────────────
        if (line.startsWith('[ADDED-LINE]')) {
          const content = line.slice('[ADDED-LINE]'.length);
          return (
            <div key={i} className="bg-green-100 text-green-800 font-semibold rounded px-1 my-0.5">
              ✨ {content || ' '}
            </div>
          );
        }

        // ── Line with inline additions ────────────────────────────────────
        if (line.includes('[ADDED]')) {
          const parts = line.split('[ADDED]');
          return (
            <div key={i} className="text-gray-700">
              <span>{parts[0]}</span>
              {parts.slice(1).map((part, j) => (
                <span
                  key={j}
                  className="bg-green-100 text-green-800 font-semibold rounded px-0.5 mx-0.5"
                >
                  ✨{part}
                </span>
              ))}
            </div>
          );
        }

        // ── Normal line ───────────────────────────────────────────────────
        return (
          <div key={i} className="text-gray-700">
            {line || ' '}
          </div>
        );
      })}
    </div>
  );
}
