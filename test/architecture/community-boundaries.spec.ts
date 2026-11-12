import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve('src/modules/community');
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory()
      ? files(target)
      : target.endsWith('.ts') && !target.endsWith('.spec.ts')
        ? [target]
        : [];
  });
}
function imports(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const result: string[] = [];
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      result.push(node.moduleSpecifier.text);
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      result.push(node.argument.literal.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) result.push(argument.text);
      else result.push('<computed-import>');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}
describe('Community production dependency boundaries', () => {
  it('keeps every Domain module independent of frameworks and outer layers', () => {
    const sources = files(path.join(root, 'domain'));
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources)
      for (const dependency of imports(source)) {
        expect(dependency.startsWith('.'), `${source}: ${dependency}`).toBe(
          true,
        );
        const target = path.resolve(path.dirname(source), dependency);
        expect(
          target.startsWith(path.join(root, 'domain') + path.sep),
          `${source}: ${dependency}`,
        ).toBe(true);
      }
  });
  it('keeps Application/ports from importing persistence, HTTP DTOs, providers or cross-context infrastructure', () => {
    const sources = files(path.join(root, 'application'));
    expect(sources.length).toBeGreaterThan(3);
    for (const source of sources)
      for (const dependency of imports(source)) {
        expect(dependency, `${source}: ${dependency}`).not.toMatch(
          /@prisma|\b(presentation|infrastructure|persistence)\b|<computed-import>/,
        );
        if (dependency.startsWith('.')) {
          const target = path.resolve(path.dirname(source), dependency);
          expect(
            target.startsWith(path.join(root, 'application') + path.sep) ||
              target.startsWith(path.join(root, 'domain') + path.sep),
            `${source}: ${dependency}`,
          ).toBe(true);
        } else
          expect(dependency, `${source}: ${dependency}`).toBe('@nestjs/common');
      }
  });
});
