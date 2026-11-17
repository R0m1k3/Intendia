import { describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import { partialTaskId } from './partial';

describe('partialTaskId', () => {
  it('gives the task id of a partial_create', () => {
    expect(partialTaskId(new ApiError(409, 'x', { code: 'partial_create', taskId: 't_1' }))).toBe('t_1');
  });
  it('null for another error or without taskId', () => {
    expect(partialTaskId(new ApiError(409, 'x', { code: 'stale', taskId: 't_1' }))).toBeNull();
    expect(partialTaskId(new ApiError(409, 'x', { code: 'partial_create' }))).toBeNull();
    expect(partialTaskId(new Error('x'))).toBeNull();
  });
});
