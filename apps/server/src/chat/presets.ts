// Pinned models and modes (option 17) of an agent (instance + profile), kept by Intendia in `settings`. A mode is a
// saved model + effort, applied to the session in one PATCH; it never changes the profile (that would
// copy the session: option 18 stays the explicit action).
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { settings } from '../db/schema.js';

export const PINS_MAX = 20;
export const MODES_MAX = 30;

const Name = z.string().min(1).max(200);
export const Pin = z.object({ provider: Name.nullable(), model: Name });
export const Pins = z.array(Pin).max(PINS_MAX);
export const Mode = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  name: z.string().trim().min(1).max(60),
  model: Name.nullable(),
  provider: Name.nullable(),
  effort: z.string().max(32).nullable(),
});
export const Modes = z.array(Mode).max(MODES_MAX);
/** Colour of each agent's avatar (index in the web's palette), per instance; absent = picked from the name. */
export const LOOK_COLORS = 8;
export const Looks = z.record(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), z.number().int().min(0).max(LOOK_COLORS - 1))
  .refine((v) => Object.keys(v).length <= 200, 'too many agents');
export type PinList = z.infer<typeof Pins>;
export type ModeList = z.infer<typeof Modes>;
export type LookMap = z.infer<typeof Looks>;

const keyOf = (kind: 'model_pins' | 'run_modes', instanceId: string, profile: string) => `${kind}:${instanceId}:${profile}`;

function read<T>(db: Db, key: string, schema: z.ZodType<T>): T | null {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function write(db: Db, key: string, value: unknown): void {
  const v = JSON.stringify(value);
  db.insert(settings).values({ key, value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v } }).run();
}

export const presets = {
  pins: (db: Db, inst: string, profile: string): PinList => read(db, keyOf('model_pins', inst, profile), Pins) ?? [],
  setPins: (db: Db, inst: string, profile: string, pins: PinList) => write(db, keyOf('model_pins', inst, profile), pins),
  modes: (db: Db, inst: string, profile: string): ModeList => read(db, keyOf('run_modes', inst, profile), Modes) ?? [],
  setModes: (db: Db, inst: string, profile: string, modes: ModeList) => write(db, keyOf('run_modes', inst, profile), modes),
  looks: (db: Db, inst: string): LookMap => read(db, `agent_looks:${inst}`, Looks) ?? {},
  setLooks: (db: Db, inst: string, looks: LookMap) => write(db, `agent_looks:${inst}`, looks),
  /** Every Intendia setting of a deleted profile (any new per-profile key goes through keyOf and here). */
  dropProfile: (db: Db, inst: string, profile: string) => {
    db.delete(settings).where(inArray(settings.key, [keyOf('model_pins', inst, profile), keyOf('run_modes', inst, profile)])).run();
    const looks = presets.looks(db, inst);
    if (profile in looks) {
      delete looks[profile];
      presets.setLooks(db, inst, looks);
    }
  },
};
