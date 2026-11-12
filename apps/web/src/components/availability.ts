import type { CompatReport, ModuleId } from '../api';

export type OpRef = [module: ModuleId, op: string];
export type OptionalOp = [module: ModuleId, op: string, label: string];

export function op(report: CompatReport, module: string, name: string) {
  return report.modules.find((m) => m.id === module)?.ops[name];
}

export interface Availability {
  available: boolean;
  /** labels of the optional ops really missing */
  missing: string[];
  reasons: string[];
  link: string | undefined;
  has: (module: string, op: string) => boolean;
  /** an op of the page is not checked yet by this version of Intendia (old report) */
  pending: boolean;
  /** only unchecked required ops keep the page closed (no real failure): neutral notice, not « indisponible » */
  onlyPending: boolean;
  checkError: string | undefined;
}

/**
 * Availability from the operations a page uses (possibly from several modules), not from the module
 * state: a missing optional write must warn, a missing required read must block. An op the report does not
 * know yet (`unchecked`) is pending until the next full check: a required one keeps the page closed (its data
 * queries start once it is checked), without counting as a failure.
 */
export function availability(report: CompatReport | undefined, module: ModuleId, required: OpRef[], optional: OptionalOp[], explainMissing = false): Availability {
  const has = (m: string, o: string) => (report ? Boolean(op(report, m, o)?.ok) : true);
  if (!report) return { available: true, missing: [], reasons: [], link: undefined, has, pending: false, onlyPending: false, checkError: undefined };
  const unchecked = new Set(report.unchecked ?? []);
  const known = ([m, o]: OpRef | OptionalOp) => !unchecked.has(`${m}.${o}`);
  const blocked = required.filter(known).filter(([m, o]) => !op(report, m, o)?.ok);
  const missingOps = optional.filter(known).filter(([m, o]) => !op(report, m, o)?.ok);
  const reasons = blocked.length
    ? blocked.flatMap(([m, o]) => op(report, m, o)?.notes ?? [`${m}.${o}`])
    : explainMissing ? missingOps.flatMap(([m, o]) => op(report, m, o)?.notes.slice(-1) ?? []) : [];
  const link = report.modules.find((m) => m.id === module)?.dashboardLink;
  const pending = [...required, ...optional].some((r) => !known(r));
  const requiredPending = required.some((r) => !known(r));
  return {
    available: blocked.length === 0 && !requiredPending, onlyPending: blocked.length === 0 && requiredPending, missing: [...new Set(missingOps.map(([, , l]) => l))], reasons: [...new Set(reasons)], link, has,
    pending, checkError: pending ? report.checkError : undefined,
  };
}

/** Polling of the compat query while the instance's report is not fully checked. */
export function compatPoll(report: CompatReport | undefined): number | false {
  if (!report?.unchecked?.length) return false;
  return report.checking ? 3000 : 30_000;
}
