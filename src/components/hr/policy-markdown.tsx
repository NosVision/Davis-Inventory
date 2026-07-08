'use client';

import { Fragment, type ReactNode } from 'react';

// A small, dependency-free Markdown renderer for HR policy bodies (owner ask 2026-07-08).
// It supports exactly the subset we author for policies: #/##/### headings, GFM pipe
// tables, "- " / "1." lists, **bold**, and blank-line paragraphs. Content is trusted
// HR-authored text, and we still build React nodes (never dangerouslySetInnerHTML) so
// there is no HTML-injection surface. Tables scroll horizontally so they stay readable
// on phones.

function renderInline(text: string, keyBase: string): ReactNode[] {
  // Split on **bold** spans, keeping the delimiters so we can style them.
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return (
        <strong key={`${keyBase}-b${i}`} className="font-semibold text-gray-900 dark:text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={`${keyBase}-t${i}`}>{part}</Fragment>;
  });
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim());
}

function isListItem(line: string): boolean {
  return /^\s*[-•]\s+/.test(line);
}
function isOrderedItem(line: string): boolean {
  return /^\s*\d+\.\s+/.test(line);
}
function isHeading(line: string): boolean {
  return /^#{1,3}\s+/.test(line.trim());
}
function isTableStart(lines: string[], i: number): boolean {
  return lines[i].trim().startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]);
}

export function PolicyMarkdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed === '') {
      i++;
      continue;
    }

    // Heading
    const h = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (h) {
      const level = h[1].length;
      const content = renderInline(h[2], `h${key}`);
      if (level === 1) {
        blocks.push(
          <h2
            key={key++}
            className="mt-7 scroll-mt-4 border-b border-gray-200 pb-1.5 text-base font-bold text-gray-900 first:mt-0 dark:border-gray-700 dark:text-white"
          >
            {content}
          </h2>
        );
      } else if (level === 2) {
        blocks.push(
          <h3 key={key++} className="mt-4 text-sm font-bold text-gray-800 dark:text-gray-100">
            {content}
          </h3>
        );
      } else {
        blocks.push(
          <h4 key={key++} className="mt-3 text-sm font-semibold text-gray-700 dark:text-gray-200">
            {content}
          </h4>
        );
      }
      i++;
      continue;
    }

    // GFM table
    if (isTableStart(lines, i)) {
      const header = splitRow(lines[i]);
      i += 2; // header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div
          key={key++}
          className="my-3 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700"
        >
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800">
                {header.map((c, ci) => (
                  <th
                    key={ci}
                    className="whitespace-nowrap border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200"
                  >
                    {renderInline(c, `th${key}-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="even:bg-gray-50/60 dark:even:bg-gray-800/40">
                  {r.map((c, ci) => (
                    <td
                      key={ci}
                      className="border-b border-gray-100 px-3 py-2 align-top text-gray-700 last:border-r-0 dark:border-gray-800 dark:text-gray-300"
                    >
                      {renderInline(c, `td${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Unordered list
    if (isListItem(lines[i])) {
      const items: string[] = [];
      while (i < lines.length && isListItem(lines[i])) {
        items.push(lines[i].trim().replace(/^[-•]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul
          key={key++}
          className="my-2 ml-4 list-disc space-y-1 text-sm text-gray-700 marker:text-gray-400 dark:text-gray-300"
        >
          {items.map((it, ii) => (
            <li key={ii} className="pl-0.5 leading-relaxed">
              {renderInline(it, `li${key}-${ii}`)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (isOrderedItem(lines[i])) {
      const items: string[] = [];
      while (i < lines.length && isOrderedItem(lines[i])) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol
          key={key++}
          className="my-2 ml-5 list-decimal space-y-1 text-sm text-gray-700 marker:text-gray-400 dark:text-gray-300"
        >
          {items.map((it, ii) => (
            <li key={ii} className="pl-0.5 leading-relaxed">
              {renderInline(it, `ol${key}-${ii}`)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph — gather consecutive plain lines until a blank line or a new block starts.
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (
        l.trim() === '' ||
        isHeading(l) ||
        isListItem(l) ||
        isOrderedItem(l) ||
        isTableStart(lines, i)
      ) {
        break;
      }
      para.push(l.trim());
      i++;
    }
    blocks.push(
      <p key={key++} className="my-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        {renderInline(para.join(' '), `p${key}`)}
      </p>
    );
  }

  return <div className="space-y-0.5">{blocks}</div>;
}
