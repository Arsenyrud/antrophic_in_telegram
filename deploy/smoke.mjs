import { query } from '@anthropic-ai/claude-agent-sdk';
const q = query({ prompt: 'Ответь одним словом: работаю', options: { maxTurns: 1 } });
for await (const m of q) {
  if (m.type === 'result') {
    console.log(JSON.stringify({ subtype: m.subtype, result: m.result?.slice(0, 100), cost: m.total_cost_usd }));
    process.exit(m.subtype === 'success' ? 0 : 1);
  }
}
