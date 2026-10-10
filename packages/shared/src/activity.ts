import type { ActivityDTO } from './types.js';

const FIELD_LABELS: Record<string, string> = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  assigneeId: 'assignee',
  dueDate: 'due date',
};

function quote(value: string | undefined, fallback = 'a task'): string {
  return value ? `“${value}”` : fallback;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Human-readable sentence for an activity entry, without the actor's name. */
export function describeActivity(activity: Pick<ActivityDTO, 'type' | 'data'>): string {
  const d = activity.data;
  switch (activity.type) {
    case 'board.created':
      return `created the board ${quote(d.boardName, '')}`.trim();
    case 'task.created':
      return `added ${quote(d.taskTitle)}${d.columnName ? ` to ${d.columnName}` : ''}`;
    case 'task.updated': {
      const fields = (d.fields ?? []).map((field) => FIELD_LABELS[field] ?? field);
      return fields.length > 0
        ? `changed the ${list(fields)} of ${quote(d.taskTitle)}`
        : `updated ${quote(d.taskTitle)}`;
    }
    case 'task.moved':
      return `moved ${quote(d.taskTitle)} from ${d.fromColumn ?? '?'} to ${d.toColumn ?? '?'}`;
    case 'task.deleted':
      return `deleted ${quote(d.taskTitle)}`;
    case 'column.created':
      return `added the column ${quote(d.columnName, '')}`.trim();
    case 'column.renamed':
      return `renamed the column ${quote(d.from, '')} to ${quote(d.to, '')}`;
    case 'column.moved':
      return `reordered the column ${quote(d.columnName, '')}`.trim();
    case 'column.deleted':
      return `deleted the column ${quote(d.columnName, '')}`.trim();
    case 'member.joined':
      return `joined the workspace`;
  }
}
