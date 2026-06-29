// PageFlow AI - pdf_extract.js
// 外部ライブラリなしの軽量 PDF テキスト抽出。
// FlateDecode ストリームをブラウザ標準の DecompressionStream で展開し、
// Tj / TJ オペレータのリテラル文字列を取り出す。
// ※ CID フォント（多くの日本語 PDF）は復号できないため、その場合は
//    空文字を返し、呼び出し側が AI 抽出 or 手入力へフォールバックする。

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
      } catch (e) { /* 次のフォーマットを試す */ }
    }
    return null;
  }

  // PDF リテラル文字列のエスケープを解決
  function unescapePdfString(s) {
    return s
      .replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c]))
      .replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
  }

  // コンテンツストリームからテキスト描画オペレータを抽出
  function extractTextOps(content) {
    const out = [];
    // (文字列) Tj   /   [(a) -120 (b)] TJ   /   (文字列) '
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
    // テキスト行の区切りオペレータごとに改行を入れる簡易処理
    return out.join('\n');
  }

  // 可読文字の割合（CID エンコード等で文字化けした場合の検出に使う)
  function readableRatio(text) {
    if (!text) return 0;
    const readable = text.match(/[0-9A-Za-z぀-ヿ一-鿿¥\/\-:., 円年月日]/g);
    return (readable ? readable.length : 0) / text.length;
  }

  async function extractPdfText(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const raw = latin1.decode(bytes);
    if (!raw.startsWith('%PDF')) throw new Error('PDF ファイルではありません');

    let result = '';
    const re = /stream\r?\n/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const start = m.index + m[0].length;
      const end = raw.indexOf('endstream', start);
      if (end < 0) continue;
      // 直前の辞書を確認（FlateDecode か非圧縮テキストのみ対象）
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
      // CID フォント等で復号不能 → 呼び出し側でフォールバック
      return '';
    }
    return result;
  }

  root.PageFlowPdf = { extractPdfText };
})(typeof self !== 'undefined' ? self : this);
