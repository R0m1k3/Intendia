// What the "Accès" page sends to add a credential to the vault of Hermes: a flat object per kind, camelCase names
// (the `field` of an error is that name). The only place where the format rules live; a message never holds a value.
import { z } from 'zod';
import { AdminError } from '../admin-error.js';
import type { HermesVaultAdd } from '../hermes/gateway-ws.js';
import { msg } from '../i18n/index.js';

export type VaultKind = 'login' | 'payment' | 'address';

/** French label of each field (also the names in "Champs obligatoires : …"). */
export const FIELD_LABEL: Record<string, string> = {
  kind: msg('Type'), label: msg('Nom'), origin: msg('Site'),
  identifierType: msg("Type d'identifiant"), identifier: msg('Identifiant'), password: msg('Mot de passe'), otpSecret: msg("Clé d'authentification"),
  cardNumber: msg('Numéro de carte'), cardholderName: msg('Titulaire'), expMonth: msg("Mois d'expiration"), expYear: msg("Année d'expiration"),
  cvc: msg('Cryptogramme'), billingPostalCode: msg('Code postal de facturation'),
  addressLine1: msg('Adresse'), addressLine2: msg("Complément d'adresse"), city: msg('Ville'), state: msg('Région'), postalCode: msg('Code postal'), country: msg('Pays'),
};

/** camelCase field → name in Hermes' `secret` (or top level for label / origin). */
const TO_HERMES: Record<string, string> = {
  identifierType: 'identifier_type', identifier: 'identifier', password: 'password', otpSecret: 'otp_secret',
  cardNumber: 'card_number', cardholderName: 'cardholder_name', expMonth: 'exp_month', expYear: 'exp_year', cvc: 'cvc',
  billingPostalCode: 'billing_postal_code',
  addressLine1: 'address_line1', addressLine2: 'address_line2', city: 'city', state: 'state', postalCode: 'postal_code', country: 'country',
};
/** Hermes name → camelCase field (to read "payment items require exp_month, cvc"). */
export const HERMES_TO_FIELD: Record<string, string> = {
  ...Object.fromEntries(Object.entries(TO_HERMES).map(([k, v]) => [v, k])),
  label: 'label', origin: 'origin',
};

const text = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) => z.string().trim().max(max).optional();

const origin = z.string().trim().min(1).max(2048).refine((v) => {
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.host);
  } catch {
    return false;
  }
}, { message: 'origin' });

const common = { label: text(120), origin };

const Login = z.strictObject({
  kind: z.literal('login'), ...common,
  identifierType: z.enum(['email', 'phone', 'username']),
  identifier: text(320),
  // a password is kept as typed (spaces included)
  password: z.string().min(1).max(1024),
  otpSecret: optional(1024),
});

const Payment = z.strictObject({
  kind: z.literal('payment'), ...common,
  cardNumber: z.string().max(40).transform((v) => v.replace(/[\s-]/g, '')).pipe(z.string().min(1).regex(/^\d{12,19}$/, { message: 'card' })),
  cardholderName: optional(120),
  expMonth: z.string().trim().min(1).regex(/^(0?[1-9]|1[0-2])$/, { message: 'month' }).transform((v) => v.padStart(2, '0')),
  expYear: z.string().trim().min(1).regex(/^(\d{2}|\d{4})$/, { message: 'year' }).transform((v) => (v.length === 2 ? `20${v}` : v)),
  cvc: z.string().trim().min(1).regex(/^\d{3,4}$/, { message: 'cvc' }),
  billingPostalCode: optional(20),
});

const Address = z.strictObject({
  kind: z.literal('address'), ...common,
  addressLine1: text(200),
  addressLine2: optional(200),
  city: text(120),
  state: optional(120),
  postalCode: text(20),
  country: text(80),
});

const VaultInputSchema = z.discriminatedUnion('kind', [Login, Payment, Address]);
export type VaultInput = z.infer<typeof VaultInputSchema>;

const FORMAT: Record<string, string> = {
  origin: msg('Adresse du site invalide (http:// ou https://)'),
  card: msg('Numéro de carte invalide'),
  month: msg('Mois entre 1 et 12'),
  year: msg('Année sur 2 ou 4 chiffres'),
  cvc: msg('3 ou 4 chiffres'),
};

/** The first problem of a refused input, as an `invalid_field` error; never quotes the value. */
function refusal(issue: z.core.$ZodIssue, body: unknown): AdminError {
  if (issue.code === 'unrecognized_keys') {
    return new AdminError('invalid_field', msg('Champ inconnu'), { field: String(issue.keys[0] ?? '') });
  }
  const field = String(issue.path[0] ?? 'kind');
  const given = body && typeof body === 'object' ? (body as Record<string, unknown>)[field] : undefined;
  let message = msg('Format invalide');
  if (given === undefined || given === null || (typeof given === 'string' && given.trim() === '')) message = msg('Champ obligatoire');
  else if (issue.code === 'invalid_union' || issue.code === 'invalid_value') message = msg('Valeur non prise en charge');
  else if (issue.code === 'invalid_type') message = msg('Champ obligatoire');
  else if (issue.code === 'too_small') message = msg('Champ obligatoire');
  else if (issue.code === 'too_big') message = msg('Trop long ({max} caractères au plus)', { max: String(issue.maximum) });
  else {
    // the schema's own `message` names the format (never a value)
    if (FORMAT[issue.message]) message = FORMAT[issue.message]!;
  }
  return new AdminError('invalid_field', message, { field });
}

/** Checks a request body; throws `AdminError('invalid_field', …, {field})`. */
export function parseVaultInput(body: unknown): VaultInput {
  const r = VaultInputSchema.safeParse(body);
  if (!r.success) throw refusal(r.error.issues[0]!, body);
  return r.data;
}

/** Hermes' `vault.add` parameters (without the profile); empty optional fields left out. */
export function toHermes(input: VaultInput): HermesVaultAdd {
  const { kind, label, origin: site, ...rest } = input;
  const secret: Record<string, string> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (typeof v === 'string' && v !== '' && TO_HERMES[k]) secret[TO_HERMES[k]] = v;
  }
  return { kind, label, origin: site, secret };
}

/** Every secret value of an input (tests: none must show up in a response or a log). */
export function secretValues(input: VaultInput): string[] {
  const { kind: _k, label: _l, origin: _o, ...rest } = input;
  return Object.values(rest).filter((v): v is string => typeof v === 'string' && v.length > 0);
}
