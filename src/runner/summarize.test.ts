import { expect, test } from 'vitest';
import { toolDetail } from './summarize.js';

test('bash shows command truncated', () => {
  expect(toolDetail('Bash', { command: 'npm test' })).toBe('npm test');
  expect(toolDetail('Bash', { command: 'x'.repeat(200) }).length).toBeLessThanOrEqual(80);
});

test('file tools show basename-ish path', () => {
  expect(toolDetail('Edit', { file_path: '/home/u/proj/src/app.ts' })).toContain('src/app.ts');
  expect(toolDetail('Read', { file_path: '/a/b.txt' })).toContain('b.txt');
});

test('unknown tool falls back to json and never throws', () => {
  expect(toolDetail('Weird', { a: 1 })).toContain('a');
  expect(toolDetail('Weird', undefined)).toBe('{}');
  const circular: any = {}; circular.self = circular;
  expect(() => toolDetail('Weird', circular)).not.toThrow();
});
