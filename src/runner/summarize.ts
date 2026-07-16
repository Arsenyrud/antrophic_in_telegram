function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function shortPath(p: unknown): string {
  const s = String(p ?? '');
  const parts = s.split('/');
  return parts.length <= 2 ? s : parts.slice(-2).join('/');
}

export function toolDetail(name: string, input: unknown): string {
  try {
    const i = (input ?? {}) as Record<string, unknown>;
    switch (name) {
      case 'Bash': return truncate(String(i.command ?? ''), 80);
      case 'Edit': case 'Write': case 'Read': case 'NotebookEdit': return shortPath(i.file_path);
      case 'Glob': case 'Grep': return truncate(String(i.pattern ?? ''), 60);
      case 'WebFetch': return truncate(String(i.url ?? ''), 60);
      case 'WebSearch': return truncate(String(i.query ?? ''), 60);
      case 'Task': return truncate(String(i.description ?? ''), 60);
      case 'TodoWrite': return 'обновляю план';
      default: return truncate(JSON.stringify(i), 60);
    }
  } catch {
    return name;
  }
}
