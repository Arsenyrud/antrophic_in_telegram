export function isUsageLimitError(message: string): boolean {
  return /usage limit|(hour|weekly|session).{0,10}limit reached|limit reached\|?\d*/i.test(message)
    && !/error_max_turns/.test(message);
}

export function parseResetTime(message: string, now: Date = new Date()): number | null {
  const pipe = message.match(/\|(\d{9,13})\s*$/);
  if (pipe) {
    const n = Number(pipe[1]);
    return n < 1e12 ? n * 1000 : n;
  }
  const m = message.match(/resets?\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3].toLowerCase() === 'pm') h += 12;
    const min = m[2] ? Number(m[2]) : 0;
    const d = new Date(now);
    d.setHours(h, min, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return null;
}
