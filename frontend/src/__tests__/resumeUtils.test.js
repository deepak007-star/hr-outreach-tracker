// vitest — pure logic tests for resumeUtils (no DOM required)
import { vi, describe, it, expect, beforeAll } from 'vitest';

// Mock browser-only deps before importing resumeUtils
vi.mock('jspdf', () => ({
  jsPDF: vi.fn().mockImplementation(() => ({
    setFontSize: vi.fn(),
    text: vi.fn(),
    addPage: vi.fn(),
    save: vi.fn(),
    splitTextToSize: vi.fn(() => []),
    internal: { pageSize: { getWidth: () => 210 } },
  })),
}));

vi.mock('docx', () => ({
  Document: vi.fn(),
  Paragraph: vi.fn(),
  TextRun: vi.fn(),
  Packer: { toBlob: vi.fn(() => Promise.resolve(new Blob())) },
  AlignmentType: { LEFT: 'left', CENTER: 'center', RIGHT: 'right' },
}));

let normalizeResumeText, modifyResume;

beforeAll(async () => {
  const mod = await import('../utils/resumeUtils.js');
  normalizeResumeText = mod.normalizeResumeText;
  modifyResume = mod.modifyResume;
});

describe('normalizeResumeText', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeResumeText('')).toBe('');
    expect(normalizeResumeText('  ')).toBe('  ');
  });

  it('collapses multiple consecutive blank lines to one', () => {
    const input = 'Line A\n\n\n\nLine B';
    const result = normalizeResumeText(input);
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain('Line A');
    expect(result).toContain('Line B');
  });

  it('joins continuation lines that start with lowercase', () => {
    const input = 'Built scalable services\nusing Node.js and PostgreSQL';
    const result = normalizeResumeText(input);
    expect(result).toBe('Built scalable services using Node.js and PostgreSQL');
  });

  it('does not join lines after ALL-CAPS headers', () => {
    const input = 'EXPERIENCE\nSoftware Engineer at Acme';
    const result = normalizeResumeText(input);
    expect(result).toContain('EXPERIENCE');
    expect(result).toContain('Software Engineer at Acme');
  });

  it('strips lone page number lines', () => {
    const input = 'Some text\n3\nMore text';
    const result = normalizeResumeText(input);
    expect(result).not.toMatch(/^\s*3\s*$/m);
  });

  it('normalizes CRLF to LF', () => {
    const input = 'Line 1\r\nLine 2\r\nLine 3';
    const result = normalizeResumeText(input);
    expect(result).not.toContain('\r');
    expect(result.split('\n').length).toBeGreaterThanOrEqual(3);
  });
});

describe('modifyResume', () => {
  it('returns original text when no skills to add', () => {
    const text = 'SKILLS\nJavaScript, React';
    expect(modifyResume(text, [])).toBe(text);
  });

  it('returns original text when rawText is empty', () => {
    expect(modifyResume('', ['Python'])).toBe('');
  });

  it('adds skills to an existing SKILLS section', () => {
    const text = [
      'John Doe',
      '',
      'SKILLS',
      'JavaScript, TypeScript, React',
      '',
      'EXPERIENCE',
      'Engineer at Acme Corp',
    ].join('\n');
    const result = modifyResume(text, ['Python', 'Docker']);
    expect(result).toContain('Python');
    expect(result).toContain('Docker');
  });

  it('appends a new SKILLS section when none exists', () => {
    const text = [
      'Jane Doe',
      '',
      'EXPERIENCE',
      'Senior Engineer at Globex',
    ].join('\n');
    const result = modifyResume(text, ['Kubernetes']);
    expect(result).toContain('Kubernetes');
  });

  it('marks added skills with [ADDED] tag', () => {
    const text = 'SKILLS\nJavaScript, TypeScript';
    const result = modifyResume(text, ['Vue']);
    // New skills are marked [ADDED] so UI can highlight them
    expect(result).toContain('[ADDED]Vue');
  });
});
