import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve('src/modules/member-engagement');
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sources(target)
      : target.endsWith('.ts') && !target.endsWith('.spec.ts')
        ? [target]
        : [];
  });
}

function imports(file: string) {
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
      result.push(
        argument && ts.isStringLiteral(argument)
          ? argument.text
          : '<computed-import>',
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

describe('MemberEngagement production dependency boundaries', () => {
  it.each(['domain', 'application'])(
    'keeps every %s source independent of Prisma, Infrastructure and HTTP',
    (layer) => {
      const files = sources(path.join(root, layer));
      expect(files.length).toBeGreaterThan(0);
      for (const file of files)
        for (const dependency of imports(file)) {
          if (!dependency.startsWith('.')) {
            expect(
              layer === 'application' && dependency === '@nestjs/common',
              `${file}: ${dependency}`,
            ).toBe(true);
            continue;
          }
          const resolved = path.resolve(path.dirname(file), dependency);
          const allowed = [
            path.join(root, 'domain'),
            ...(layer === 'application'
              ? [path.join(root, 'application')]
              : []),
          ];
          expect(
            allowed.some((directory) =>
              resolved.startsWith(directory + path.sep),
            ),
            `${file}: ${dependency}`,
          ).toBe(true);
        }
    },
  );
});
