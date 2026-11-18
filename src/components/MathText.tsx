import katex from 'katex';

interface MathTextProps {
  text: string;
  className?: string;
  as?: 'div' | 'span';
}

interface Segment {
  kind: 'codeblock' | 'blockmath' | 'inlinemath' | 'text';
  value: string;
  lang?: string;
}

const TOKEN_REGEX =
  /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$(?!\s)((?:\\.|[^$\n\\])+?)(?<!\s)\$/g;

function looksLikeCurrencyOnly(inner: string): boolean {
  // Avoid treating plain dollar amounts like "$50" or "$120.50" as math if followed by another "$..." later on the same line
  return /^\d[\d,.]*(?:\s*(?:USD|JMD|CAD|EUR|per|to|-))?$/i.test(inner.trim());
}

function tokenizeMathAndCode(input: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;

  for (const match of input.matchAll(TOKEN_REGEX)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) {
      segments.push({ kind: 'text', value: input.slice(lastIndex, idx) });
    }

    if (match[2] !== undefined) {
      segments.push({ kind: 'codeblock', lang: match[1] || '', value: match[2] });
    } else if (match[3] !== undefined) {
      segments.push({ kind: 'blockmath', value: match[3] });
    } else if (match[4] !== undefined) {
      segments.push({ kind: 'blockmath', value: match[4] });
    } else if (match[5] !== undefined) {
      segments.push({ kind: 'inlinemath', value: match[5] });
    } else if (match[6] !== undefined) {
      const inner = match[6];
      if (looksLikeCurrencyOnly(inner)) {
        segments.push({ kind: 'text', value: match[0] });
      } else {
        segments.push({ kind: 'inlinemath', value: inner });
      }
    }

    lastIndex = idx + match[0].length;
  }

  if (lastIndex < input.length) {
    segments.push({ kind: 'text', value: input.slice(lastIndex) });
  }

  return segments;
}

function renderInlineFormatting(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`\n]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={`${keyPrefix}-b-${i}`} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={`${keyPrefix}-c-${i}`}
          className="px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-900 font-mono text-[0.88em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={`${keyPrefix}-t-${i}`}>{part}</span>;
  });
}

function renderKatexHtml(expr: string, displayMode: boolean): string {
  try {
    return katex.renderToString(expr.trim(), {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
    });
  } catch {
    return expr;
  }
}

export function containsLatex(text: string): boolean {
  if (!text) return false;
  return /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\\)\$(?!\s)[^$\n]+?(?<!\s)\$/.test(
    text,
  );
}

export function MathText({ text, className = '', as = 'div' }: MathTextProps) {
  if (!text) return null;

  const segments = tokenizeMathAndCode(text);
  const Wrapper = as;

  return (
    <Wrapper className={`whitespace-pre-wrap break-words ${as === 'span' ? 'inline-block' : ''} ${className}`}>
      {segments.map((seg, idx) => {
        if (seg.kind === 'codeblock') {
          if (as === 'span') {
            return (
              <span
                key={idx}
                className="block my-2 rounded-lg bg-slate-900 text-slate-100 p-3 text-xs font-mono overflow-x-auto leading-relaxed"
              >
                <code>{seg.value.replace(/^\n+|\n+$/g, '')}</code>
              </span>
            );
          }
          return (
            <pre
              key={idx}
              className="my-2 rounded-lg bg-slate-900 text-slate-100 p-3 text-xs font-mono overflow-x-auto leading-relaxed"
            >
              <code>{seg.value.replace(/^\n+|\n+$/g, '')}</code>
            </pre>
          );
        }

        if (seg.kind === 'blockmath') {
          const html = renderKatexHtml(seg.value, true);
          return (
            <span
              key={idx}
              className="block my-2 overflow-x-auto py-1"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        if (seg.kind === 'inlinemath') {
          const html = renderKatexHtml(seg.value, false);
          return (
            <span
              key={idx}
              className="inline-block align-baseline mx-0.5"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        return <span key={idx}>{renderInlineFormatting(seg.value, String(idx))}</span>;
      })}
    </Wrapper>
  );
}

export const LATEX_SNIPPETS: Array<{ label: string; snippet: string }> = [
  { label: 'Fraction', snippet: '$\\frac{a}{b}$' },
  { label: 'Summation', snippet: '$$\\sum_{i=1}^{n} x_i$$' },
  { label: 'Bayes Rule', snippet: '$$P(A|B) = \\frac{P(B|A)P(A)}{P(B)}$$' },
  { label: 'Gradient', snippet: '$\\nabla_\\theta J(\\theta)$' },
  { label: 'Sqrt', snippet: '$\\sqrt{x}$' },
  { label: 'Set / Logic', snippet: '$\\forall x \\in S$' },
  { label: 'Sigmoid', snippet: '$$\\sigma(z) = \\frac{1}{1 + e^{-z}}$$' },
];
