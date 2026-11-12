import {
  SYSTEM_CONFIG_CATALOG,
  assertConfigVersion,
  normalizeConfigValue,
} from './system-config.js';
import type { ContactEmailValidator } from './system-config.js';

const emailValidator: ContactEmailValidator = {
  isValid: (value) => value === 'ski@example.com',
};
describe('System configuration value rules', () => {
  it.each(SYSTEM_CONFIG_CATALOG)(
    'trims and enforces the $configKey Unicode limit',
    (d) => {
      if (d.configKey === 'site.contactEmail') {
        expect(
          normalizeConfigValue(
            d.configKey,
            ' ski@example.com ',
            emailValidator,
          ),
        ).toBe('ski@example.com');
      } else {
        expect(
          normalizeConfigValue(
            d.configKey,
            ` ${'😀'.repeat(d.maxLength)} `,
            emailValidator,
          ),
        ).toBe('😀'.repeat(d.maxLength));
      }
      expect(() =>
        normalizeConfigValue(
          d.configKey,
          'x'.repeat(d.maxLength + 1),
          emailValidator,
        ),
      ).toThrow('characters');
    },
  );
  it.each([null, undefined, 1, {}, '', '  '])(
    'rejects nontext or empty values %j',
    (value) => {
      expect(() =>
        normalizeConfigValue('site.name', value, emailValidator),
      ).toThrow();
    },
  );
  it('applies the supplied email policy after trimming and refuses its rejection', () => {
    const policy = { isValid: vi.fn(() => false) };
    expect(() =>
      normalizeConfigValue('site.contactEmail', ' ski@example.com ', policy),
    ).toThrow('email');
    expect(policy.isValid).toHaveBeenCalledExactlyOnceWith('ski@example.com');
    policy.isValid.mockReturnValue(true);
    expect(
      normalizeConfigValue('site.contactEmail', ' ski@example.com ', policy),
    ).toBe('ski@example.com');
  });
  it('does not apply the email policy to other text fields', () => {
    const policy = { isValid: vi.fn(() => false) };
    expect(normalizeConfigValue('site.name', ' 凛迹雪客 ', policy)).toBe(
      '凛迹雪客',
    );
    expect(policy.isValid).not.toHaveBeenCalled();
  });
  it('rejects unknown keys and invalid/exhausted versions', () => {
    expect(() =>
      normalizeConfigValue('JWT_SECRET', 'secret', emailValidator),
    ).toThrow('not found');
    for (const value of [-1, 1.2, NaN, Infinity, 2147483648])
      expect(() => assertConfigVersion(value)).toThrow('expectedVersion');
    expect(() => assertConfigVersion(2147483647)).toThrow('exhausted');
  });
});
