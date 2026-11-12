import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const modules = path.resolve('src/modules');
const contexts = readdirSync(modules, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'health')
  .map((entry) => entry.name);
const sharedDomainContracts = new Set([
  'identity-access/domain/authorization.js',
  'identity-access/domain/authorization-resources.js',
  'identity-access/domain/data-scope.js',
  'identity-access/domain/permissions.js',
  'integration-events/domain/integration-event.js',
  'platform-administration/domain/custom-field-validation.js',
  'platform-administration/domain/business-query.js',
]);
const sharedApplicationPorts = new Set([
  'assets/application/ports/asset-storage.js',
  'integration-events/application/ports/inbox-lease.js',
  'platform-administration/application/ports/custom-field-repository.js',
]);
const extraApplicationContracts = new Set([
  'identity-access/domain/management-write-authorization.js',
]);

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sources(file)
      : file.endsWith('.ts') && !file.endsWith('.spec.ts')
        ? [file]
        : [];
  });
}
function imports(text: string): string[] {
  const source = ts.createSourceFile(
    'source.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const dependencies: string[] = [];
  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      dependencies.push(node.moduleSpecifier.text);
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      dependencies.push(node.argument.literal.text);
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const specifier = node.moduleReference.expression;
      dependencies.push(
        specifier && ts.isStringLiteral(specifier)
          ? specifier.text
          : '<computed>',
      );
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      const specifier = node.arguments[0];
      dependencies.push(
        specifier && ts.isStringLiteral(specifier)
          ? specifier.text
          : '<computed>',
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return dependencies;
}
function relativeContract(file: string, dependency: string): string {
  return path
    .relative(modules, path.resolve(path.dirname(file), dependency))
    .split(path.sep)
    .join('/');
}

describe('DDD boundaries across all business contexts', () => {
  it('examines static, re-export, type, dynamic, require and computed dependencies', () => {
    expect(
      imports(
        [
          "import { a } from './a.js'; export { b } from './b.js';",
          "type C = import('./c.js').C; const d = import('./d.js');",
          "const e = require('./e.js'); import f = require('./f.js');",
          'const g = import(variable);',
        ].join('\n'),
      ),
    ).toEqual([
      './a.js',
      './b.js',
      './c.js',
      './d.js',
      './e.js',
      './f.js',
      '<computed>',
    ]);
    expect(contexts.length).toBeGreaterThanOrEqual(9);
  });
  for (const context of contexts) {
    it(`${context}: Domain has no framework, provider, HTTP or persistence dependency`, () => {
      const directory = path.join(modules, context, 'domain');
      expect(existsSync(directory)).toBe(true);
      const files = sources(directory);
      expect(files.length).toBeGreaterThan(0);
      const violations: string[] = [];
      for (const file of files) {
        for (const dependency of imports(readFileSync(file, 'utf8'))) {
          const target = relativeContract(file, dependency);
          if (
            !dependency.startsWith('.') ||
            (!target.startsWith(`${context}/domain/`) &&
              !sharedDomainContracts.has(target))
          )
            violations.push(`${path.relative(modules, file)} -> ${dependency}`);
        }
      }
      expect(violations).toEqual([]);
    });
    it(`${context}: Application uses its own rules and explicit contracts, never outer implementations`, () => {
      const directory = path.join(modules, context, 'application');
      expect(existsSync(directory)).toBe(true);
      const files = sources(directory);
      expect(files.length).toBeGreaterThan(0);
      const external = new Set(['@nestjs/common']);
      if (
        [
          'ai-assistant',
          'assets',
          'platform-administration',
          'resort-management',
        ].includes(context)
      )
        external.add('node:crypto');
      if (context === 'ai-assistant') external.add('@nestjs/config');
      if (context === 'resort-management') external.add('csv-parse/sync');
      const violations: string[] = [];
      for (const file of files) {
        for (const dependency of imports(readFileSync(file, 'utf8'))) {
          if (dependency.startsWith('.')) {
            const target = relativeContract(file, dependency);
            if (
              !target.startsWith(`${context}/application/`) &&
              !target.startsWith(`${context}/domain/`) &&
              !sharedDomainContracts.has(target) &&
              !sharedApplicationPorts.has(target) &&
              !extraApplicationContracts.has(target)
            )
              violations.push(
                `${path.relative(modules, file)} -> ${dependency}`,
              );
          } else if (!external.has(dependency))
            violations.push(`${path.relative(modules, file)} -> ${dependency}`);
        }
      }
      expect(violations).toEqual([]);
    });
  }
});
