// LaTeX → HTML renderer for Jake's-resume-style .tex files
// Handles: \section, \resumeSubheading, \resumeSubheadingSimple,
//          \resumeProjectHeading, \resumeItemListStart/End,
//          \resumeSubHeadingListStart/End, \resumeItem,
//          inline: \textbf \textit \emph \underline \href $math$

// ── Argument extractor ────────────────────────────────────────────────────────
// Extracts n brace-balanced arguments from a (possibly multi-line) string.
export function extractArgs(str, n) {
  const args = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    while (i < str.length && str[i] !== '{') i++;
    if (i >= str.length) break;
    i++; // skip {
    let depth = 1;
    let start = i;
    while (i < str.length && depth > 0) {
      if (str[i] === '\\') { i += 2; continue; }
      if (str[i] === '{') depth++;
      else if (str[i] === '}') depth--;
      i++;
    }
    args.push(str.slice(start, i - 1));
  }
  return args;
}

// Returns the index of the line AFTER n complete {}-args have been consumed,
// starting from startLine. Used to advance the line cursor past multi-line macros.
export function advancePastArgs(lines, startLine, n) {
  let joined = '';
  let lineIdx = startLine;
  let argsConsumed = 0;
  let pos = 0;

  while (lineIdx < lines.length && argsConsumed < n) {
    joined += (lineIdx > startLine ? '\n' : '') + lines[lineIdx];
    // Count newly completed args from pos onward
    while (pos < joined.length && argsConsumed < n) {
      if (joined[pos] === '\\') { pos += 2; continue; }
      if (joined[pos] === '{') {
        let depth = 1;
        pos++;
        while (pos < joined.length && depth > 0) {
          if (joined[pos] === '\\') { pos += 2; continue; }
          if (joined[pos] === '{') depth++;
          else if (joined[pos] === '}') depth--;
          if (depth > 0) pos++;
          else pos++;
        }
        argsConsumed++;
      } else {
        pos++;
      }
    }
    if (argsConsumed >= n) return lineIdx + 1;
    lineIdx++;
  }
  return lineIdx + 1;
}

// ── Inline LaTeX → HTML string ────────────────────────────────────────────────
export function renderInline(text) {
  if (!text) return '';
  let r = text;

  // Four passes to handle nesting like \textbf{\textit{...}}
  for (let pass = 0; pass < 4; pass++) {
    r = r
      .replace(/\\textbf\{([^{}]*)\}/g, '<strong>$1</strong>')
      .replace(/\\textit\{([^{}]*)\}/g, '<em>$1</em>')
      .replace(/\\emph\{([^{}]*)\}/g, '<em>$1</em>')
      .replace(/\\underline\{([^{}]*)\}/g, '<u>$1</u>')
      .replace(/\\texttt\{([^{}]*)\}/g, '<code style="font-family:monospace;font-size:.9em;background:#f3f4f6;padding:0 2px;border-radius:2px">$1</code>')
      .replace(/\\textsc\{([^{}]*)\}/g, '<span style="font-variant:small-caps">$1</span>')
      .replace(/\\small\{([^{}]*)\}/g, '<small>$1</small>');
  }

  r = r
    // href / url
    .replace(/\\href\{[^}]*\}\{([^}]+)\}/g, '<span style="color:#1d4ed8;text-decoration:underline">$1</span>')
    .replace(/\\url\{([^}]+)\}/g, '<span style="color:#1d4ed8">$1</span>')
    // Math symbols
    .replace(/\$\\rightarrow\$/g, '→')
    .replace(/\$\\leftarrow\$/g, '←')
    .replace(/\$\\Rightarrow\$/g, '⇒')
    .replace(/\$\\Leftarrow\$/g, '⟸')
    .replace(/\$\\longrightarrow\$/g, '⟶')
    .replace(/\$\\leftrightarrow\$/g, '↔')
    .replace(/\$\\cdot\$/g, '·')
    .replace(/\$\\bullet\$/g, '•')
    .replace(/\$\\vert\$/g, '|')
    .replace(/\$\\mid\$/g, '|')
    .replace(/\$\|\\$/g, '|')
    .replace(/\$\|\$/g, '|')
    // Inline math: $...$  — strip delimiters, render content as-is
    .replace(/\$([^$]+)\$/g, (_, m) => {
      return m
        .replace(/\\rightarrow/g, '→').replace(/\\leftarrow/g, '←')
        .replace(/\\cdot/g, '·').replace(/\\times/g, '×')
        .replace(/\\vert/g, '|').replace(/\\mid/g, '|')
        .replace(/\\[a-zA-Z]+/g, '');
    })
    // Punctuation ligatures
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``/g, '“')
    .replace(/''/g, '”')
    // Special chars
    .replace(/~/g, ' ')
    .replace(/\\\\/g, '<br/>')
    .replace(/\\,/g, ' ')
    .replace(/\\;/g, ' ')
    .replace(/\\%/g, '%')
    .replace(/\\&/g, '&amp;')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\\$/g, '$')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    // Strip remaining unknown single-arg macros (preserve content)
    .replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, '$1')
    // Strip remaining bare commands
    .replace(/\\[a-zA-Z@]+\*?/g, '')
    .trim();

  return r;
}

// ── Block-level LaTeX → HTML ───────────────────────────────────────────────────
export function renderLatexToHtml(code) {
  if (!code || !code.trim()) return '';

  const lines = code.split('\n');
  const out   = [];
  let i = 0;
  let inDocument = false;

  // Helper: collect remaining lines as a single string for arg extraction
  const rem = () => lines.slice(i).join('\n');

  while (i < lines.length) {
    const raw  = lines[i];
    const line = raw.trim();

    // ── Skip preamble ─────────────────────────────────────────────────────────
    if (!inDocument) {
      if (line.includes('\\begin{document}')) inDocument = true;
      i++;
      continue;
    }
    if (line.includes('\\end{document}')) break;

    // Skip blank lines and comments
    if (!line || line.startsWith('%')) { i++; continue; }

    // ── \begin{center} ... \end{center} ──────────────────────────────────────
    if (line.includes('\\begin{center}')) {
      i++;
      const centerParts = [];
      while (i < lines.length && !lines[i].includes('\\end{center}')) {
        const cl = lines[i].trim();
        if (cl && !cl.startsWith('%')) centerParts.push(cl);
        i++;
      }
      const centerHtml = centerParts
        .join(' ')
        .replace(/\\\\(\s*\[.*?\])?/g, '<br/>');
      if (centerHtml.trim()) {
        out.push(`<div style="text-align:center;margin-bottom:6px;font-size:11px">${renderInline(centerHtml)}</div>`);
      }
      i++; // skip \end{center}
      continue;
    }

    // ── \name{First}{Last} or \name{Full Name} ────────────────────────────────
    if (line.startsWith('\\name{')) {
      const args = extractArgs(rem(), 2);
      const name = args.length >= 2 ? `${args[0]} ${args[1]}` : (args[0] || '');
      out.push(`<h1 style="text-align:center;font-size:22px;font-weight:700;margin:0 0 4px 0;letter-spacing:-0.01em">${renderInline(name)}</h1>`);
      i = advancePastArgs(lines, i, args.length >= 2 ? 2 : 1);
      continue;
    }

    // ── \address{...} ─────────────────────────────────────────────────────────
    if (line.startsWith('\\address{')) {
      const args = extractArgs(rem(), 1);
      out.push(`<p style="text-align:center;font-size:11px;color:#374151;margin:0 0 8px 0">${renderInline(args[0] || '')}</p>`);
      i = advancePastArgs(lines, i, 1);
      continue;
    }

    // ── \vspace / \medskip / \bigskip / \smallskip ───────────────────────────
    if (/^\\(vspace|medskip|bigskip|smallskip|noindent|centering)/.test(line)) {
      out.push('<div style="height:3px"></div>');
      i++;
      continue;
    }

    // ── \hrule or \rule{...}{...} ─────────────────────────────────────────────
    if (/^\\(hrule|rule|vspace\*?\{[^}]*\}\\rule)/.test(line)) {
      out.push('<hr style="border:none;border-top:0.8px solid #374151;margin:3px 0"/>');
      i++;
      continue;
    }

    // ── \section{Name} ────────────────────────────────────────────────────────
    const secM = line.match(/^\\section\{(.+)\}/) ||
                 (line.startsWith('\\section{') ? [null, extractArgs(rem(), 1)[0]] : null);
    if (secM) {
      const title = secM[1] || extractArgs(rem(), 1)[0] || '';
      out.push(`<div style="margin-top:12px;margin-bottom:4px;border-bottom:1.4px solid #111;padding-bottom:2px">
        <span style="font-size:11.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase">${renderInline(title)}</span>
      </div>`);
      i++;
      continue;
    }

    // ── \resumeSubHeadingListStart/End ────────────────────────────────────────
    if (line === '\\resumeSubHeadingListStart') { out.push('<div style="margin:2px 0 4px 2px">'); i++; continue; }
    if (line === '\\resumeSubHeadingListEnd')   { out.push('</div>');                             i++; continue; }

    // ── \resumeItemListStart/End ──────────────────────────────────────────────
    if (line === '\\resumeItemListStart') { out.push('<ul style="margin:2px 0 4px 0;list-style:none;padding:0">'); i++; continue; }
    if (line === '\\resumeItemListEnd')   { out.push('</ul>');                                                      i++; continue; }

    // ── \resumeSubheading{Org}{Loc}{Title}{Dates} ────────────────────────────
    if (line.startsWith('\\resumeSubheading{') || line === '\\resumeSubheading') {
      const args = extractArgs(rem(), 4);
      const [org, loc, title, dates] = args;
      out.push(`<div style="margin-bottom:3px;margin-top:5px">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <strong style="font-size:12px;color:#111">${renderInline(org || '')}</strong>
          <span style="font-size:10.5px;color:#6b7280">${renderInline(loc || '')}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <em style="font-size:11px;color:#374151">${renderInline(title || '')}</em>
          <span style="font-size:10.5px;color:#6b7280">${renderInline(dates || '')}</span>
        </div>
      </div>`);
      i = advancePastArgs(lines, i, 4);
      continue;
    }

    // ── \resumeSubheadingSimple{Org}{Dates}{Degree} ──────────────────────────
    if (line.startsWith('\\resumeSubheadingSimple{') || line === '\\resumeSubheadingSimple') {
      const args = extractArgs(rem(), 3);
      const [org, dates, degree] = args;
      out.push(`<div style="display:flex;justify-content:space-between;align-items:baseline;margin:4px 0 2px">
        <div>
          <strong style="font-size:12px;color:#111">${renderInline(org || '')}</strong>
          <em style="font-size:11px;color:#4b5563;margin-left:8px">${renderInline(degree || '')}</em>
        </div>
        <span style="font-size:10.5px;color:#6b7280">${renderInline(dates || '')}</span>
      </div>`);
      i = advancePastArgs(lines, i, 3);
      continue;
    }

    // ── \resumeProjectHeading{\textbf{Name} $|$ \emph{Tech}}{Dates} ──────────
    if (line.startsWith('\\resumeProjectHeading{') || line === '\\resumeProjectHeading') {
      const args = extractArgs(rem(), 2);
      const [title, dates] = args;
      out.push(`<div style="display:flex;justify-content:space-between;align-items:baseline;margin:5px 0 2px">
        <span style="font-size:12px;color:#111">${renderInline(title || '')}</span>
        <span style="font-size:10.5px;color:#6b7280">${renderInline(dates || '')}</span>
      </div>`);
      i = advancePastArgs(lines, i, 2);
      continue;
    }

    // ── \resumeHeading{Title}{Dates} (one-line variant) ──────────────────────
    if (line.startsWith('\\resumeHeading{') || line === '\\resumeHeading') {
      const args = extractArgs(rem(), 2);
      const [title, dates] = args;
      out.push(`<div style="display:flex;justify-content:space-between;align-items:baseline;margin:4px 0 1px">
        <strong style="font-size:12px;color:#111">${renderInline(title || '')}</strong>
        <span style="font-size:10.5px;color:#6b7280">${renderInline(dates || '')}</span>
      </div>`);
      i = advancePastArgs(lines, i, 2);
      continue;
    }

    // ── \resumeItem{text} ─────────────────────────────────────────────────────
    if (line.startsWith('\\resumeItem{') || line === '\\resumeItem') {
      const args = extractArgs(rem(), 1);
      out.push(`<li style="display:flex;gap:6px;margin-bottom:1.5px;font-size:11px;line-height:1.55;color:#1f2937">
        <span style="flex-shrink:0;color:#6b7280;margin-top:1.5px">•</span>
        <span>${renderInline(args[0] || '')}</span>
      </li>`);
      i = advancePastArgs(lines, i, 1);
      continue;
    }

    // ── \resumeTechItem{Label}{Value} ─────────────────────────────────────────
    if (line.startsWith('\\resumeTechItem{') || line === '\\resumeTechItem') {
      const args = extractArgs(rem(), 2);
      out.push(`<li style="display:flex;gap:6px;margin-bottom:1.5px;font-size:11px;line-height:1.55">
        <span style="flex-shrink:0;color:#6b7280;margin-top:1.5px">•</span>
        <span><strong>${renderInline(args[0] || '')}</strong>: ${renderInline(args[1] || '')}</span>
      </li>`);
      i = advancePastArgs(lines, i, 2);
      continue;
    }

    // ── Skip other LaTeX commands ─────────────────────────────────────────────
    if (line.startsWith('\\')) { i++; continue; }

    // ── Inline text (shouldn't normally appear outside sections, but handle it) ──
    if (line) {
      out.push(`<p style="font-size:11px;color:#374151;margin:1px 0;line-height:1.5">${renderInline(line)}</p>`);
    }

    i++;
  }

  return out.join('\n');
}
