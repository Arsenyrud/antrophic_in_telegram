export type SessionMode = 'auto' | 'plan';
// 'ultracode' — не значение SDK-параметра, а верхняя ступень слайдера:
// раннер разворачивает её в effort=xhigh + системную директиву на мульти-агентную оркестрацию.
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultracode';

export interface Session {
  name: string;
  cwd: string;
  claudeSessionId: string | null;
  model: string | null;   // полный ID модели (claude-opus-4-8 …) или null = дефолт
  effort: Effort | null;  // уровень reasoning или null = дефолт
  mode: SessionMode;
  activeTaskId: string | null;
}

export type Pending =
  | { kind: 'new-session' }
  | { kind: 'new-project' }
  | { kind: 'forward-comment'; taskId: string; from: string; to: string };

export interface ChatState {
  sessions: Record<string, Session>;
  current: string;
  pending?: Pending;
}

export interface State {
  chats: Record<string, ChatState>;
}

export interface TaskMeta {
  taskId: string;
  chatId: number;
  sessionName: string;
  prompt: string;
  cwd: string;
  resumeSessionId: string | null;
  model: string | null;
  effort: Effort | null;
  mode: SessionMode;
  startedAt: number;
}

export type TaskEvent =
  | { type: 'init'; sessionId: string; ts: number }
  | { type: 'text'; text: string; ts: number }
  | { type: 'tool'; name: string; detail: string; ts: number }
  | { type: 'turn_done'; text: string; costUsd: number | null; turns: number; ts: number }
  | { type: 'limit_wait'; resetAt: number | null; ts: number }
  | { type: 'inject'; text: string; ts: number }
  | { type: 'done'; ts: number }
  | { type: 'error'; message: string; ts: number };
