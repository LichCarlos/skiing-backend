import { ContactEmailValidatorAdapter } from './contact-email-validator.adapter.js';

describe('Contact email syntax adapter', () => {
  const validator = new ContactEmailValidatorAdapter();
  it.each([
    'ski@example.com',
    'first.last+snow@resort.example.com',
    '用户@例子.中国',
    'ski@xn--fsqu00a.xn--fiqs8s',
  ])('keeps existing supported email syntax: %s', (value) => {
    expect(validator.isValid(value)).toBe(true);
  });
  it.each([
    'x',
    'a@b',
    'a..b@example.com',
    'a@-bad.com',
    'x@example.com\nBcc:other@example.com',
    'ski@example.com,other@example.com',
    'Name <ski@example.com>',
    'ski@[127.0.0.1]',
  ])('keeps rejecting invalid/unsupported email syntax: %s', (value) => {
    expect(validator.isValid(value)).toBe(false);
  });
});
