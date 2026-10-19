/**
 * Export and document download utilities for VoiceText v2.0.
 * Pure browser-native file generation (TXT, Markdown, PDF via printable iframe)
 * without external cloud dependencies or third-party tracking.
 */

export function downloadTextFile(content: string, filename: string, mimeType = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportAsTxt(text: string, title = 'voicetext-transcript'): void {
  const filename = `${title}-${getDateStamp()}.txt`;
  downloadTextFile(text, filename, 'text/plain');
}

export function exportAsMarkdown(text: string, title = 'voicetext-transcript'): void {
  const date = new Date().toLocaleString();
  const mdContent = `# VoiceText Transcript\n\n*Generated on ${date}*\n\n---\n\n${text}\n`;
  const filename = `${title}-${getDateStamp()}.md`;
  downloadTextFile(mdContent, filename, 'text/markdown');
}

/**
 * Native browser printable PDF export using a hidden clean iframe and window.print().
 * Completely offline, zero external PDF libraries needed.
 */
export function exportAsPdf(text: string, title = 'VoiceText Transcript'): void {
  const printFrame = document.createElement('iframe');
  printFrame.style.position = 'fixed';
  printFrame.style.right = '0';
  printFrame.style.bottom = '0';
  printFrame.style.width = '0';
  printFrame.style.height = '0';
  printFrame.style.border = '0';
  document.body.appendChild(printFrame);

  const doc = printFrame.contentWindow?.document;
  if (!doc) return;

  const date = new Date().toLocaleString();
  const escaped = escapeHtml(text).replace(/\n/g, '<br/>');

  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          @page { margin: 20mm; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #111827;
            line-height: 1.6;
            font-size: 14px;
            padding: 20px;
          }
          h1 {
            font-size: 20px;
            border-bottom: 2px solid #e5e7eb;
            padding-bottom: 8px;
            margin-bottom: 6px;
            color: #1f2937;
          }
          .meta {
            font-size: 11px;
            color: #6b7280;
            margin-bottom: 24px;
          }
          .content {
            font-size: 15px;
            line-height: 1.7;
            white-space: pre-wrap;
            word-wrap: break-word;
          }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">Exported on ${date} • VoiceText</div>
        <div class="content">${escaped}</div>
      </body>
    </html>
  `);
  doc.close();

  setTimeout(() => {
    try {
      printFrame.contentWindow?.focus();
      printFrame.contentWindow?.print();
    } catch {
      // Ignore print errors
    } finally {
      setTimeout(() => {
        if (printFrame.parentNode) {
          printFrame.parentNode.removeChild(printFrame);
        }
      }, 2000);
    }
  }, 300);
}

function getDateStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
