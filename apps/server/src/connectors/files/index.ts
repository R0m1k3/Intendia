import { z } from 'zod';
import type { ModuleDef } from '../types.js';

/** One entry of GET /api/files: `path` is resolved (symbolic links followed), except for a broken link. */
export const FilesEntrySchema = z.looseObject({
  name: z.string(),
  path: z.string(),
  is_directory: z.boolean(),
  size: z.number().nullish(),
  mtime: z.number().nullish(),
  broken_link: z.boolean().optional(),
});
export type HermesFileEntry = z.infer<typeof FilesEntrySchema>;

export const FilesListSchema = z.looseObject({
  path: z.string(),
  locked_root: z.string().nullable(),
  entries: z.array(FilesEntrySchema),
});
export type HermesFilesList = z.infer<typeof FilesListSchema>;

/**
 * Managed files of the dashboard (`/api/files*`), confined to one root per Hermes process
 * (HERMES_DASHBOARD_FILES_ROOT). The only code that talks to these routes; workspace files go through it.
 */
export const filesModule: ModuleDef = {
  id: 'files',
  label: 'Fichiers',
  ops: {
    list: {
      kind: 'read', required: true, probe: true, schema: FilesListSchema,
      routes: [{ via: 'dash', method: 'GET', path: '/api/files' }],
    },
    download: {
      kind: 'read', required: true, probe: false,
      routes: [{ via: 'dash', method: 'GET', path: '/api/files/download' }],
    },
    upload: {
      kind: 'write',
      routes: [{ via: 'dash', method: 'POST', path: '/api/files/upload-stream' }],
    },
    mkdir: {
      kind: 'write',
      routes: [{ via: 'dash', method: 'POST', path: '/api/files/mkdir' }],
    },
    remove: {
      kind: 'write',
      routes: [{ via: 'dash', method: 'DELETE', path: '/api/files' }],
    },
  },
};
