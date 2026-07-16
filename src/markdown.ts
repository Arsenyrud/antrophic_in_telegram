export function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

type Block = { kind: 'code'; lang: string; body: string } | { kind: 'text'; body: string };

function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const re = /```([\w+-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    if (m.index > last) blocks.push({ kind: 'text', body: md.slice(last, m.index) });
    blocks.push({ kind: 'code', lang: m[1], body: m[2].replace(/\n$/, '') });
    last = re.lastIndex;
  }
  if (last < md.length) blocks.push({ kind: 'text', body: md.slice(last) });
  return blocks;
}

function inlineToHtml(text: string): string {
  let s = escapeHtml(text);
  const codes: string[] = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c: string) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '<i>$1</i>');
  s = s.replace(/(?<![\w_])_([^_\n]+)_(?![\w_])/g, '<i>$1</i>');
  s = s
    .split('\n')
    .map((line) => {
      const h = line.match(/^#{1,6}\s+(.*)$/);
      if (h) return `<b>${h[1]}</b>`;
      return line.replace(/^(\s*)[-*]\s+/, '$1• ');
    })
    .join('\n');
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i: string) => codes[Number(i)] ?? m);
  return s;
}

function renderCode(lang: string, body: string): string {
  const cls = lang ? ` class="language-${lang}"` : '';
  return `<pre><code${cls}>${escapeHtml(body)}</code></pre>`;
}

function splitText(html: string, maxLen: number): string[] {
  const out: string[] = [];
  let rest = html;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('\n', maxLen);
    if (cut < maxLen * 0.3) cut = maxLen;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) out.push(rest);
  return out;
}

function splitCode(lang: string, body: string, maxLen: number): string[] {
  const overhead = renderCode(lang, '').length + 16; // запас на экранирование по краям
  const out: string[] = [];
  let rest = body;
  while (rest.length > 0) {
    let take = Math.max(1, Math.min(rest.length, maxLen - overhead));
    // не резать посреди html-сущности после экранирования: подберём кусок, чей рендер влезает
    while (renderCode(lang, rest.slice(0, take)).length > maxLen && take > 10) take -= 10;
    out.push(renderCode(lang, rest.slice(0, take)));
    rest = rest.slice(take);
  }
  return out;
}

export function mdToTelegramChunks(md: string, maxLen = 4096): string[] {
  const pieces: string[] = [];
  for (const b of parseBlocks(md)) {
    if (b.kind === 'code') {
      const rendered = renderCode(b.lang, b.body);
      if (rendered.length <= maxLen) pieces.push(rendered);
      else pieces.push(...splitCode(b.lang, b.body, maxLen));
    } else {
      const html = inlineToHtml(b.body).replace(/\n{3,}/g, '\n\n').trim();
      if (!html) continue;
      pieces.push(...splitText(html, maxLen));
    }
  }
  // упаковка кусков в чанки ≤ maxLen
  const chunks: string[] = [];
  let cur = '';
  for (const p of pieces) {
    const joined = cur ? cur + '\n\n' + p : p;
    if (joined.length <= maxLen) cur = joined;
    else {
      if (cur) chunks.push(cur);
      cur = p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [''];
}
