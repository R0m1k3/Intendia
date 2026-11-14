// Fields of the "Accès" form per kind. Format rules live on the server only (it names the wrong `field`); the form
// only knows which fields are required, to mark them and to keep the button off while one is empty.
import type { VaultKind } from '../api';
import { t } from '../i18n';

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

const site: VaultField = { name: 'origin', label: t('Site'), required: true, secret: false, inputMode: 'url', autoComplete: 'off', placeholder: t('https://exemple.fr') };
const name: VaultField = { name: 'label', label: t('Nom'), required: true, secret: false, autoComplete: 'off' };

export const FIELDS: Record<VaultKind, VaultField[]> = {
  login: [
    { ...name, placeholder: t('GitHub travail') },
    site,
    // identifierType is a select, drawn apart
    { name: 'identifier', label: t('Identifiant|coffre'), required: true, secret: false, autoComplete: 'off' },
    { name: 'password', label: t('Mot de passe'), required: true, secret: true, autoComplete: 'new-password' },
    { name: 'otpSecret', label: t("Clé d'authentification (2FA)"), required: false, secret: true, autoComplete: 'off', hint: t('La « clé de configuration » ou le lien otpauth:// donnés par le site ; l’agent saisira les codes lui-même.') },
  ],
  payment: [
    { ...name, placeholder: t('Carte pro') },
    { ...site, hint: t('La carte ne sera remplie que sur ce site.') },
    { name: 'cardNumber', label: t('Numéro de carte'), required: true, secret: true, inputMode: 'numeric', autoComplete: 'off' },
    { name: 'cardholderName', label: t('Titulaire'), required: false, secret: false, autoComplete: 'off' },
    { name: 'expMonth', label: t("Mois d'expiration"), required: true, secret: false, inputMode: 'numeric', autoComplete: 'off', placeholder: 'MM' },
    { name: 'expYear', label: t("Année d'expiration"), required: true, secret: false, inputMode: 'numeric', autoComplete: 'off', placeholder: t('AAAA') },
    { name: 'cvc', label: t('Cryptogramme'), required: true, secret: true, inputMode: 'numeric', autoComplete: 'off' },
    { name: 'billingPostalCode', label: t('Code postal de facturation'), required: false, secret: false, autoComplete: 'off' },
  ],
  address: [
    { ...name, placeholder: t('Maison') },
    { ...site, hint: t('L’adresse ne sera remplie que sur ce site.') },
    { name: 'addressLine1', label: t('Adresse'), required: true, secret: false, autoComplete: 'off' },
    { name: 'addressLine2', label: t("Complément d'adresse"), required: false, secret: false, autoComplete: 'off' },
    { name: 'postalCode', label: t('Code postal'), required: true, secret: false, autoComplete: 'off' },
    { name: 'city', label: t('Ville'), required: true, secret: false, autoComplete: 'off' },
    { name: 'state', label: t('Région'), required: false, secret: false, autoComplete: 'off' },
    { name: 'country', label: t('Pays'), required: true, secret: false, autoComplete: 'off' },
  ],
};

export const KIND_LABEL: Record<VaultKind, string> = { login: t('Identifiant|coffre'), payment: t('Carte'), address: t('Adresse') };
export const KIND_GROUP: Record<VaultKind, string> = { login: t('Identifiants'), payment: t('Cartes'), address: t('Adresses') };

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
