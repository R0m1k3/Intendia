import { errorCode, errorData } from '../config/common';

/** 409 `partial_create`: the task was created but a later step failed; its id, to open it. */
export function partialTaskId(err: unknown): string | null {
  if (errorCode(err) !== 'partial_create') return null;
  const id = errorData(err).taskId;
  return typeof id === 'string' && id ? id : null;
}
