import { expect, test } from 'vitest';
import { escapeHtml, mdToTelegramChunks } from './markdown.js';

test('escapes html entities', () => {
  expect(escapeHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
});

test('renders bold, italic, inline code, links', () => {
  const [out] = mdToTelegramChunks('**жирный** и *курсив* и `x<1` и [док](https://a.b/c?x=1&y=2)');
  expect(out).toContain('<b>жирный</b>');
  expect(out).toContain('<i>курсив</i>');
  expect(out).toContain('<code>x&lt;1</code>');
  expect(out).toContain('<a href="https://a.b/c?x=1&amp;y=2">док</a>');
});

test('renders fenced code with language', () => {
  const [out] = mdToTelegramChunks('```ts\nconst a = 1 < 2;\n```');
  expect(out).toBe('<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>');
});

test('headings become bold, bullets become dots', () => {
  const [out] = mdToTelegramChunks('## Итог\n- один\n- два');
  expect(out).toContain('<b>Итог</b>');
  expect(out).toContain('• один');
});

test('splits long text on newlines under maxLen', () => {
  const md = Array.from({ length: 50 }, (_, i) => `строка ${i} `.repeat(10)).join('\n');
  const chunks = mdToTelegramChunks(md, 500);
  expect(chunks.length).toBeGreaterThan(1);
  for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500);
});

test('never splits inside a code block; oversized code becomes multiple pre', () => {
  const body = 'x'.repeat(1200);
  const chunks = mdToTelegramChunks('до\n```\n' + body + '\n```\nпосле', 500);
  for (const c of chunks) {
    expect(c.length).toBeLessThanOrEqual(500);
    const opens = (c.match(/<pre>/g) ?? []).length;
    const closes = (c.match(/<\/pre>/g) ?? []).length;
    expect(opens).toBe(closes);
  }
  expect(chunks.join('')).toContain('x'.repeat(100));
});

test('splitText never cuts through an HTML tag', () => {
  // много ссылок, чтобы форсировать жёсткий разрез именно по тегам
  const md = Array.from({ length: 40 }, (_, i) => `[ссылка номер ${i}](https://example.com/very/long/path/${i})`).join(' ');
  const chunks = mdToTelegramChunks(md, 300);
  expect(chunks.length).toBeGreaterThan(1);
  for (const c of chunks) {
    expect(c.length).toBeLessThanOrEqual(300);
    // ни один кусок не заканчивается внутри тега: после последнего '<' есть '>'
    const lt = c.lastIndexOf('<');
    const gt = c.lastIndexOf('>');
    expect(gt).toBeGreaterThanOrEqual(lt);
  }
});

test('splitText does not cut inside an HTML entity', () => {
  const md = '&'.repeat(200) + ' конец'; // каждый & → &amp;
  const chunks = mdToTelegramChunks(md, 120);
  for (const c of chunks) {
    // не заканчивается «оборванной» сущностью вида &am
    expect(/&[a-z]{0,6}$/.test(c)).toBe(false);
  }
});
