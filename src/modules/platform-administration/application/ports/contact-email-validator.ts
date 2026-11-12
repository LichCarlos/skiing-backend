// Domain owns the rule contract; Infrastructure owns the validation library.
export type { ContactEmailValidator } from '../../domain/system-config.js';
export const CONTACT_EMAIL_VALIDATOR = Symbol('CONTACT_EMAIL_VALIDATOR');
