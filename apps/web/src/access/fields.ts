// Fields of the "Accès" form per kind. Format rules live on the server only (it names the wrong `field`); the form
// only knows which fields are required, to mark them and to keep the button off while one is empty.
import type { VaultKind } from '../api';

export interface VaultField {
  name: string;
  label: string;
  required: boolean;
  /** Typed hidden (type=password, eye button) and never kept outside the form. */
  secret: boolean;
  inputMode?: 'text' | 'numeric' | 'email' | 'url';
  autoComplete: string;
  placeholder?: string;
  hint?: string;
}

const site: VaultField = { name: 'origin', label: 'Site', required: true, secret: false, inputMode: 'url', autoComplete: 'off', placeholder: 'https://exemple.fr' };
const name: VaultField = { name: 'label', label: 'Nom', required: true, secret: false, autoComplete: 'off' };

export const FIELDS: Record<VaultKind, VaultField[]> = {
  login: [
    { ...name, placeholder: 'GitHub travail' },
    site,
    // identifierType is a select, drawn apart
    { name: 'identifier', label: 'Identifiant', required: true, secret: false, autoComplete: 'off' },
    { name: 'password', label: 'Mot de passe', required: true, secret: true, autoComplete: 'new-password' },
    { name: 'otpSecret', label: "Clé d'authentification (2FA)", required: false, secret: true, autoComplete: 'off', hint: 'La « clé de configuration » ou le lien otpauth:// donnés par le site ; l’agent saisira les codes lui-même.' },
  ],
  payment: [
    { ...name, placeholder: 'Carte pro' },
    { ...site, hint: 'La carte ne sera remplie que sur ce site.' },
    { name: 'cardNumber', label: 'Numéro de carte', required: true, secret: true, inputMode: 'numeric', autoComplete: 'off' },
    { name: 'cardholderName', label: 'Titulaire', required: false, secret: false, autoComplete: 'off' },
    { name: 'expMonth', label: "Mois d'expiration", required: true, secret: false, inputMode: 'numeric', autoComplete: 'off', placeholder: 'MM' },
    { name: 'expYear', label: "Année d'expiration", required: true, secret: false, inputMode: 'numeric', autoComplete: 'off', placeholder: 'AAAA' },
    { name: 'cvc', label: 'Cryptogramme', required: true, secret: true, inputMode: 'numeric', autoComplete: 'off' },
    { name: 'billingPostalCode', label: 'Code postal de facturation', required: false, secret: false, autoComplete: 'off' },
  ],
  address: [
    { ...name, placeholder: 'Maison' },
    { ...site, hint: 'L’adresse ne sera remplie que sur ce site.' },
    { name: 'addressLine1', label: 'Adresse', required: true, secret: false, autoComplete: 'off' },
    { name: 'addressLine2', label: "Complément d'adresse", required: false, secret: false, autoComplete: 'off' },
    { name: 'postalCode', label: 'Code postal', required: true, secret: false, autoComplete: 'off' },
    { name: 'city', label: 'Ville', required: true, secret: false, autoComplete: 'off' },
    { name: 'state', label: 'Région', required: false, secret: false, autoComplete: 'off' },
    { name: 'country', label: 'Pays', required: true, secret: false, autoComplete: 'off' },
  ],
};

export const KIND_LABEL: Record<VaultKind, string> = { login: 'Identifiant', payment: 'Carte', address: 'Adresse' };
export const KIND_GROUP: Record<VaultKind, string> = { login: 'Identifiants', payment: 'Cartes', address: 'Adresses' };

/** Required fields still empty (spaces only = empty). */
export function missing(kind: VaultKind, values: Record<string, string>): string[] {
  return FIELDS[kind].filter((f) => f.required && !(values[f.name] ?? '').trim()).map((f) => f.name);
}

/** The body sent to the server: the fields of the kind only, optional empty ones left out. */
export function toInput(kind: VaultKind, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { kind };
  if (kind === 'login') out.identifierType = values.identifierType || 'email';
  for (const f of FIELDS[kind]) {
    const v = values[f.name] ?? '';
    if (v.trim() || f.required) out[f.name] = v;
  }
  return out;
}
