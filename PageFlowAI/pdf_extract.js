// PageFlow AI - pdf_extract.js
// Lightweight PDF text extraction with no external libraries.
// Inflates FlateDecode streams using the browser's built-in
// DecompressionStream and pulls literal strings out of Tj / TJ operators.
// Note: CID-encoded fonts (common in some scanned/embedded-font PDFs) can't
// be decoded this way, so in that case an empty string is returned and the
// caller falls back to AI extraction or manual entry.

(function (root) {
  'use strict';

  const latin1 = new TextDecoder('latin1');

  async function inflate(bytes) {
    for (const format of ['deflate', 'deflate-raw']) {
      try {
        const ds = new DecompressionStream(format);
        const stream = new Blob([bytes]).stream().pipeThrough(ds);
        const buf = await new Response(stream).arrayBuffer();
        return new Uint8Array(buf);
      } catch (e) { /* try the next format */ }
    }
    return null;
  }

  // Resolve escape sequences in PDF literal strings
  function unescapePdfString(s) {
    return s
      .replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c]))
      .replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
  }

  // Extract text-drawing operators from a content stream
  function extractTextOps(content) {
    const out = [];
    // (string) Tj   /   [(a) -120 (b)] TJ   /   (string) '
    const re = /\(((?:[^()\\]|\\.)*)\)\s*(Tj|')|\[((?:[^\]\\]|\\.)*)\]\s*TJ/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      if (m[1] !== undefined) {
        out.push(unescapePdfString(m[1]));
      } else if (m[3] !== undefined) {
        const inner = m[3];
        const strRe = /\(((?:[^()\\]|\\.)*)\)/g;
        let sm;
        let parts = '';
        while ((sm = strRe.exec(inner)) !== null) parts += unescapePdfString(sm[1]);
        if (parts) out.push(parts);
      }
    }
    // Simple approach: join with newlines between text-drawing operators
    return out.join('\n');
  }

  // Ratio of readable characters (used to detect garbled CID-encoded text)
  function readableRatio(text) {
    if (!text) return 0;
    const readable = text.match(/[0-9A-Za-z$€£\/\-:., ]/g);
    return (readable ? readable.length : 0) / text.length;
  }

  async function extractPdfText(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const raw = latin1.decode(bytes);
    if (!raw.startsWith('%PDF')) throw new Error('Not a PDF file');

    let result = '';
    const re = /stream\r?\n/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const start = m.index + m[0].length;
      const end = raw.indexOf('endstream', start);
      if (end < 0) continue;
      // Check the preceding dictionary (only handle FlateDecode or uncompressed text)
      const dictStart = raw.lastIndexOf('<<', m.index);
      const dict = dictStart >= 0 ? raw.slice(dictStart, m.index) : '';
      const body = bytes.subarray(start, end);

      let content = null;
      if (/FlateDecode/.test(dict)) {
        const inflated = await inflate(body);
        if (inflated) content = latin1.decode(inflated);
      } else if (!/Filter/.test(dict)) {
        content = latin1.decode(body);
      }
      if (content && /\b(Tj|TJ)\b/.test(content)) {
        result += extractTextOps(content) + '\n';
      }
    }

    result = result.trim();
    if (!result || readableRatio(result) < 0.5) {
      // Undecodable (e.g. CID fonts) -> let the caller fall back
      return '';
    }
    return result;
  }

  root.PageFlowPdf = { extractPdfText };
})(typeof self !== 'undefined' ? self : this);
