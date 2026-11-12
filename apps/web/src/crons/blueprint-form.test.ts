import { describe, expect, it } from 'vitest';
import type { Blueprint, BlueprintField } from '../api';
import { blueprintDefaults, blueprintValues, controlOf, missingFields, optionLabel } from './blueprint-form';

const field = (over: Partial<BlueprintField>): BlueprintField => ({ name: 'x', type: 'text', label: 'X', default: null, options: [], optional: false, strict: true, help: null, ...over });
const opts = (...v: string[]) => v.map((x) => ({ value: x, label: x }));
const bp: Blueprint = {
  key: 'morning-brief', title: 'Morning brief', description: null, category: null, schedule: '0 8 * * *', source: null, plugin: null,
  fields: [
    field({ name: 'time', type: 'time', default: '08:00' }),
    field({ name: 'style', type: 'enum', options: [{ value: 'short', label: 'Short' }, { value: 'long', label: 'Long' }] }),
    field({ name: 'topic', type: 'text' }),
    field({ name: 'note', type: 'textarea', optional: true }),
    field({ name: 'level', type: 'enum' }),
    field({ name: 'recurrence', type: 'weekdays', default: 'everyday', options: opts('everyday', 'weekdays', 'weekends') }),
    field({ name: 'deliver', type: 'enum', default: 'origin', options: opts('origin', 'local'), strict: false }),
  ],
};

describe('blueprint form', () => {
  it('picks a control per field: closed list = select, suggestions = text with a list, no option = text', () => {
    expect(bp.fields.map(controlOf)).toEqual(['time', 'select', 'text', 'text', 'text', 'select', 'suggest']);
    expect(optionLabel(bp.fields[5]!, { value: 'weekdays', label: 'weekdays' })).toBe('du lundi au vendredi');
    expect(optionLabel(bp.fields[1]!, { value: 'short', label: 'Short' })).toBe('Short');
  });

  it('starts from the defaults, else the first option, else empty', () => {
    expect(blueprintDefaults(bp)).toEqual({ time: '08:00', style: 'short', topic: '', note: '', level: '', recurrence: 'everyday', deliver: 'origin' });
  });

  it('lists the empty required fields and sends only the template fields, trimmed', () => {
    const v = { ...blueprintDefaults(bp), topic: '  météo ', other: 'x' };
    expect(missingFields(bp, v).map((f) => f.name)).toEqual(['level']);
    expect(blueprintValues(bp, v)).toEqual({ time: '08:00', style: 'short', topic: 'météo', recurrence: 'everyday', deliver: 'origin' });
  });
});
