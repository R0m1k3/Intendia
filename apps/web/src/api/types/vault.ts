export type VaultKind = 'login' | 'payment' | 'address';
/** An item of the credential vault of Hermes: metadata only (Hermes never gives a secret back). */
export interface VaultItem {
  id: string;
  kind: VaultKind;
  label: string;
  origin: string | null;
  createdAt: string | null;
  identifier: string | null;
  identifierType: 'email' | 'phone' | 'username' | null;
  hasOtp: boolean;
}
/** What the form sends: flat, one shape per kind (checked by the server, which names the wrong `field`). */
export type VaultInput = { kind: VaultKind; label: string; origin: string } & Record<string, string>;
