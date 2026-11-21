import type { Task } from '@mice/shared';
import { todayISO } from './format';

export interface DayGroup { day: string; tasks: Task[]; overdue: boolean }

/** Group tasks by local due date (YYYY-MM-DD), sorted ascending; tasks without date go last under 'none'. */
export function groupTasksByDay(tasks: Task[], now: Date = new Date()): DayGroup[] {
  const today = todayISO(now);
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.status === 'cancelled') continue;
    const day = t.dueAt ? todayISO(new Date(t.dueAt.length === 10 ? `${t.dueAt}T00:00:00` : t.dueAt)) : 'none';
    const list = map.get(day) ?? [];
    list.push(t);
    map.set(day, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === 'none' ? 1 : b === 'none' ? -1 : a.localeCompare(b)))
    .map(([day, list]) => ({
      day,
      tasks: list.sort((x, y) => (x.dueAt ?? '').localeCompare(y.dueAt ?? '')),
      overdue: day !== 'none' && day < today && list.some((t) => t.status === 'open'),
    }));
}

/** Inside a project screen the task title's leading project code ("PRJ-0001-… · " / "PRJ-0001-…: ") is redundant. */
export function taskTitleInProject(title: string): string {
  return title.replace(/^[A-Z]{2,6}-\d{3,}[\w-]*\s*[·:]\s*/, '');
}
