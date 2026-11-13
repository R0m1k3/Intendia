import { describe, expect, it } from 'vitest';
import { FIELDS, missing, toInput } from './fields';

describe('vault form fields', () => {
  it('requires the same fields as the server', () => {
    const req = (k: keyof typeof FIELDS) => FIELDS[k].filter((f) => f.required).map((f) => f.name).sort();
    expect(req('login')).toEqual(['identifier', 'label', 'origin', 'password']);
    expect(req('payment')).toEqual(['cardNumber', 'cvc', 'expMonth', 'expYear', 'label', 'origin']);
    expect(req('address')).toEqual(['addressLine1', 'city', 'country', 'label', 'origin', 'postalCode']);
  });

  it('a field of spaces is still missing; the secrets are the hidden fields', () => {
    expect(missing('login', { label: 'x', origin: 'https://a.fr', identifier: '  ', password: 'p' })).toEqual(['identifier']);
    expect(missing('login', { label: 'x', origin: 'https://a.fr', identifier: 'moi', password: 'p' })).toEqual([]);
    expect(FIELDS.payment.filter((f) => f.secret).map((f) => f.name)).toEqual(['cardNumber', 'cvc']);
    expect(FIELDS.login.find((f) => f.name === 'password')!.autoComplete).toBe('new-password');
  });

  it('sends the fields of the kind only, optional empty ones left out', () => {
    expect(toInput('login', { label: 'L', origin: 'https://a.fr', identifier: 'moi', password: ' p ', otpSecret: '', cardNumber: '4111' }))
      .toEqual({ kind: 'login', identifierType: 'email', label: 'L', origin: 'https://a.fr', identifier: 'moi', password: ' p ' });
    expect(toInput('address', { label: 'M', origin: 'https://a.fr', addressLine1: '1 rue', addressLine2: '', city: 'Nancy', postalCode: '54000', country: 'France' }))
      .not.toHaveProperty('addressLine2');
  });
});
