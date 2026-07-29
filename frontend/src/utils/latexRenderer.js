// LaTeX → HTML renderer for Jake's-resume-style .tex files
// Handles: \section, \resumeSubheading, \resumeSubheadingSimple,
//          \resumeProjectHeading, \resumeItemListStart/End,
//          \resumeSubHeadingListStart/End, \resumeItem,
//          inline: \textbf \textit \emph \underline \href \color \Huge \large etc.

// ── Argument extractor ────────────────────────────────────────────────────────
export function extractArgs(str, n) {
  const args = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    while (i < str.length && str[i] !== '{') i++;
    if (i >= str.length) break;
    i++;
    let depth = 1, start = i;
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

export function advancePastArgs(lines, startLine, n) {
  let joined = '', lineIdx = startLine, argsConsumed = 0, pos = 0;
  while (lineIdx < lines.length && argsConsumed < n) {
    joined += (lineIdx > startLine ? '\n' : '') + lines[lineIdx];
    while (pos < joined.length && argsConsumed < n) {
      if (joined[pos] === '\\') { pos += 2; continue; }
      if (joined[pos] === '{') {
        let depth = 1; pos++;
        while (pos < joined.length && depth > 0) {
          if (joined[pos] === '\\') { pos += 2; continue; }
          if (joined[pos] === '{') depth++;
          else if (joined[pos] === '}') depth--;
          if (depth > 0) pos++; else pos++;
        }
        argsConsumed++;
      } else pos++;
    }
    if (argsConsumed >= n) return lineIdx + 1;
    lineIdx++;
  }
  return lineIdx + 1;
}

// ── Inline LaTeX → HTML ───────────────────────────────────────────────────────
export function renderInline(text) {
  if (!text) return '';
  let r = text;

  // 1. Strip spacing/layout commands that produce no visible content
  r = r
    .replace(/\\(?:vspace|hspace|addvspace|kern|skip)\*?\{[^{}]*\}/g, '')
    .replace(/\\(?:vspace|hspace)\*?/g, '')
    .replace(/\\(?:noindent|centering|raggedright|raggedleft|hfill|vfill|hline|linebreak|newpage|clearpage|newline|par|relax|null|leavevmode|allowbreak|break|nopagebreak|samepage)\b/g, '')
    .replace(/\\(?:setlength|setcounter|addtolength|renewcommand|newcommand|geometry|usepackage|pagestyle|fancyhf|fancyfoot|renewcommand)\b[^\\]*/g, '')
    .replace(/\\begin\{[^{}]*\}|\\end\{[^{}]*\}/g, '');

  // 2. Strip font size modifiers (they appear before text in braces)
  r = r.replace(/\\(?:Huge|huge|LARGE|Large|large|normalsize|small|footnotesize|scriptsize|tiny)\b\s*/g, '');

  // 3. Handle color: \textcolor{color}{text} → text, \color{...} → ''
  for (let p = 0; p < 3; p++) {
    r = r.replace(/\\textcolor\{[^{}]*\}\{([^{}]*)\}/g, '$1');
  }
  r = r.replace(/\\color\{[^{}]*\}/g, '');

  // 4. Inline formatting — four passes for nesting
  for (let pass = 0; pass < 4; pass++) {
    r = r
      .replace(/\\textbf\{([^{}]*)\}/g, '<strong>$1</strong>')
      .replace(/\\textit\{([^{}]*)\}/g, '<em>$1</em>')
      .replace(/\\emph\{([^{}]*)\}/g, '<em>$1</em>')
      .replace(/\\underline\{([^{}]*)\}/g, '<u>$1</u>')
      .replace(/\\texttt\{([^{}]*)\}/g, '<code style="font-family:monospace;font-size:.9em">$1</code>')
      .replace(/\\textsc\{([^{}]*)\}/g, '<span style="font-variant:small-caps">$1</span>')
      .replace(/\\textrm\{([^{}]*)\}/g, '$1')
      .replace(/\\mbox\{([^{}]*)\}/g, '$1')
      .replace(/\\text\{([^{}]*)\}/g, '$1');
  }

  // 5. href / url
  r = r
    .replace(/\\href\{[^{}]*\}\{([^{}]+)\}/g, '<a href="#" style="color:#1d4ed8;text-decoration:underline">$1</a>')
    .replace(/\\url\{([^{}]+)\}/g, '<span style="color:#1d4ed8">$1</span>');

  // 6. Math symbols ($ ... $)
  r = r
    .replace(/\$\\rightarrow\$/g, '→')
    .replace(/\$\\leftarrow\$/g, '←')
    .replace(/\$\\Rightarrow\$/g, '⇒')
    .replace(/\$\\longrightarrow\$/g, '⟶')
    .replace(/\$\\leftrightarrow\$/g, '↔')
    .replace(/\$\\cdot\$/g, '·')
    .replace(/\$\\bullet\$/g, '•')
    .replace(/\$\\vert\$/g, '|')
    .replace(/\$\\mid\$/g, '|')
    .replace(/\$\s*\|\s*\$/g, ' | ')
    .replace(/\$([^$]+)\$/g, (_, m) =>
      m.replace(/\\rightarrow/g,'→').replace(/\\leftarrow/g,'←')
       .replace(/\\cdot/g,'·').replace(/\\times/g,'×')
       .replace(/\\vert/g,'|').replace(/\\mid/g,'|')
       .replace(/\\[a-zA-Z]+/g,'')
    );

  // 7. Punctuation
  r = r
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/``/g, '"')
    .replace(/''/g, '"')
    .replace(/\\\\(?:\s*\[.*?\])?/g, '<br/>')  // \\ line break
    .replace(/\~/g, ' ')
    .replace(/\\,/g, ' ')
    .replace(/\\;/g, ' ')
    .replace(/\\%/g, '%')
    .replace(/\\&/g, '&amp;')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\\$/g, '$')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}');

  // 8. Strip remaining unknown single-arg macros (keep content)
  for (let p = 0; p < 3; p++) {
    r = r.replace(/\\[a-zA-Z@]+\*?\{([^{}]*)\}/g, '$1');
  }

  // 9. Strip remaining bare commands
  r = r.replace(/\\[a-zA-Z@]+\*?/g, '');

  // 10. Strip lone grouping braces {text} → text (LaTeX grouping, not needed in HTML)
  for (let p = 0; p < 4; p++) {
    r = r.replace(/\{([^{}]*)\}/g, '$1');
  }

  // 11. Clean up leftover braces and whitespace
  r = r.replace(/[{}]/g, '').replace(/\s{2,}/g, ' ').trim();

  return r;
}

// ── Block-level LaTeX → HTML ──────────────────────────────────────────────────
export function renderLatexToHtml(code) {
  if (!code || !code.trim()) return '';

  const lines = code.split('\n');
  const out   = [];
  let i = 0;
  let inDocument = false;

  const rem = () => lines.slice(i).join('\n');

  while (i < lines.length) {
    const raw  = lines[i];
    const line = raw.trim();

    // Skip preamble until \begin{document}
    if (!inDocument) {
      if (line.includes('\\begin{document}')) inDocument = true;
      i++; continue;
    }
    if (line.includes('\\end{document}')) break;
    if (!line || line.startsWith('%')) { i++; continue; }

    // ── \begin{center} ... \end{center} ─────────────────────────────────────
    if (line.includes('\\begin{center}')) {
      i++;
      const rawCenter = [];
      while (i < lines.length && !lines[i].includes('\\end{center}')) {
        const cl = lines[i].trim();
        if (cl && !cl.startsWith('%')) rawCenter.push(cl);
        i++;
      }

      // Join, then split on LaTeX line-breaks (\\ or \\[Xpt])
      const joined   = rawCenter.join(' ');
      const segments = joined
        .split(/\\\\(?:\s*\[[\w.]+\])?/)
        .map(s => s.trim())
        .filter(Boolean);

      const rendered = segments.map((seg, idx) => {
        const html = renderInline(seg);
        if (!html.trim()) return '';
        if (idx === 0) {
          // Name line — largest
          return `<div style="font-size:21px;font-weight:700;color:#111;letter-spacing:-0.01em;margin-bottom:2px">${html}</div>`;
        }
        if (idx === 1) {
          // Subtitle / title line
          return `<div style="font-size:12px;color:#374151;font-style:italic;margin-bottom:3px">${html}</div>`;
        }
        // Contact line(s)
        return `<div style="font-size:10.5px;color:#6b7280;margin-bottom:1px">${html}</div>`;
      });

      out.push(`<div style="text-align:center;margin-bottom:12px">${rendered.join('')}</div>`);
      i++; continue;
    }

    // ── \name{First}{Last} or \name{Full Name} ────────────────────────────────
    if (line.startsWith('\\name{')) {
      const args = extractArgs(rem(), 2);
      const name = args.length >= 2 ? `${args[0]} ${args[1]}` : (args[0] || '');
      out.push(`<h1 style="text-align:center;font-size:21px;font-weight:700;margin:0 0 4px 0">${renderInline(name)}</h1>`);
      i = advancePastArgs(lines, i, args.length >= 2 ? 2 : 1); continue;
    }

    // ── \address{...} ─────────────────────────────────────────────────────────
    if (line.startsWith('\\address{')) {
      const args = extractArgs(rem(), 1);
      out.push(`<p style="text-align:center;font-size:10.5px;color:#6b7280;margin:0 0 6px 0">${renderInline(args[0] || '')}</p>`);
      i = advancePastArgs(lines, i, 1); continue;
    }

    // ── Spacing/rule-only lines ────────────────────────────────────────────────
    if (/^\\(?:vspace|medskip|bigskip|smallskip|noindent|centering|hspace)/.test(line)) { i++; continue; }
    if (/^\\(?:hrule|rule\b)/.test(line) || /^\\noindent\\rule/.test(line)) {
      out.push('<hr style="border:none;border-top:0.8px solid #374151;margin:3px 0"/>');
      i++; continue;
    }

    // ── \section{Name} ────────────────────────────────────────────────────────
    if (line.startsWith('\\section{') || line.startsWith('\\section*{')) {
      const args = extractArgs(rem(), 1);
      out.push(`<div style="margin-top:12px;margin-bottom:4px;border-bottom:1.4px solid #111;padding-bottom:2px">
        <span style="font-size:11.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase">${renderInline(args[0] || '')}</span>
      </div>`);
      i++; continue;
    }

    // ── List containers ────────────────────────────────────────────────────────
    if (/^\\resumeSubHeadingListStart/.test(line)) { out.push('<div style="margin:2px 0 4px 0">'); i++; continue; }
    if (/^\\resumeSubHeadingListEnd/.test(line))   { out.push('</div>');                          i++; continue; }
    if (/^\\resumeItemListStart/.test(line))        { out.push('<ul style="margin:2px 0 5px 0;list-style:none;padding:0">'); i++; continue; }
    if (/^\\resumeItemListEnd/.test(line))          { out.push('</ul>');                          i++; continue; }

    // ── \resumeSubheading{Org}{Loc}{Title}{Dates} ─────────────────────────────
    if (/^\\resumeSubheading\b/.test(line)) {
      const args = extractArgs(rem(), 4);
      out.push(`<div style="margin-bottom:1px;margin-top:6px">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <strong style="font-size:12px;color:#111">${renderInline(args[0]||'')}</strong>
          <span style="font-size:10.5px;color:#6b7280;white-space:nowrap;margin-left:8px">${renderInline(args[1]||'')}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <em style="font-size:11px;color:#374151">${renderInline(args[2]||'')}</em>
          <span style="font-size:10.5px;color:#6b7280;white-space:nowrap;margin-left:8px">${renderInline(args[3]||'')}</span>
        </div>
      </div>`);
      i = advancePastArgs(lines, i, 4); continue;
    }

    // ── \resumeSubheadingSimple{Org}{Dates}{Degree} ──────────────────────────
    if (/^\\resumeSubheadingSimple\b/.test(line)) {
      const args = extractArgs(rem(), 3);
      out.push(`<div style="display:flex;justify-content:space-between;align-items:baseline;margin:5px 0 2px">
        <div>
          <strong style="font-size:12px;color:#111">${renderInline(args[0]||'')}</strong>
          <em style="font-size:11px;color:#4b5563;margin-left:8px">${renderInline(args[2]||'')}</em>
        </div>
        <span style="font-size:10.5px;color:#6b7280;white-space:nowrap">${renderInline(args[1]||'')}</span>
      </div>`);
      i = advancePastArgs(lines, i, 3); continue;
    }

    // ── \resumeProjectHeading{Title $|$ Tech}{Dates} ─────────────────────────
    if (/^\\resumeProjectHeading\b/.test(line)) {
      const args = extractArgs(rem(), 2);
      out.push(`<div style="display:flex;justify-content:space-between;align-items:baseline;margin:6px 0 2px">
        <span style="font-size:12px;color:#111">${renderInline(args[0]||'')}</span>
        <span style="font-size:10.5px;color:#6b7280;white-space:nowrap;margin-left:8px">${renderInline(args[1]||'')}</span>
      </div>`);
      i = advancePastArgs(lines, i, 2); continue;
    }

    // ── \resumeHeading{Title}{Dates} ─────────────────────────────────────────
    if (/^\\resumeHeading\b/.test(line)) {
      const args = extractArgs(rem(), 2);
      out.push(`<div style="display:flex;justify-content:space-between;align-items:baseline;margin:5px 0 1px">
        <strong style="font-size:12px;color:#111">${renderInline(args[0]||'')}</strong>
        <span style="font-size:10.5px;color:#6b7280;white-space:nowrap">${renderInline(args[1]||'')}</span>
      </div>`);
      i = advancePastArgs(lines, i, 2); continue;
    }

    // ── \resumeItem{text} ─────────────────────────────────────────────────────
    if (/^\\resumeItem\b/.test(line)) {
      const args = extractArgs(rem(), 1);
      const html = renderInline(args[0] || '');
      if (html.trim()) {
        out.push(`<li style="display:flex;gap:6px;margin-bottom:2px;font-size:11px;line-height:1.55;color:#1f2937">
          <span style="flex-shrink:0;color:#6b7280;margin-top:1px">•</span>
          <span>${html}</span>
        </li>`);
      }
      i = advancePastArgs(lines, i, 1); continue;
    }

    // ── \resumeSubItem{text} ─────────────────────────────────────────────────
    if (/^\\resumeSubItem\b/.test(line)) {
      const args = extractArgs(rem(), 1);
      const html = renderInline(args[0] || '');
      if (html.trim()) {
        out.push(`<li style="display:flex;gap:6px;margin-bottom:2px;font-size:11px;line-height:1.55;color:#374151;padding-left:12px">
          <span style="flex-shrink:0;color:#9ca3af;margin-top:1px">◦</span>
          <span>${html}</span>
        </li>`);
      }
      i = advancePastArgs(lines, i, 1); continue;
    }

    // ── \item{text} or \item text (inside itemize/enumerate) ─────────────────
    if (/^\\item\b/.test(line)) {
      const rest = line.replace(/^\\item\b\s*/, '');
      const html = renderInline(rest || '');
      if (html.trim()) {
        out.push(`<li style="display:flex;gap:6px;margin-bottom:2px;font-size:11px;line-height:1.55;color:#374151">
          <span style="flex-shrink:0;color:#6b7280;margin-top:1px">•</span>
          <span>${html}</span>
        </li>`);
      }
      i++; continue;
    }

    // ── Skip other LaTeX commands ─────────────────────────────────────────────
    if (line.startsWith('\\')) { i++; continue; }

    // ── Plain text line ───────────────────────────────────────────────────────
    const html = renderInline(line);
    if (html.trim()) {
      out.push(`<p style="font-size:11px;color:#374151;margin:1px 0;line-height:1.5">${html}</p>`);
    }
    i++;
  }

  return out.join('\n');
}
