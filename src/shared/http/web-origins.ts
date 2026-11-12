export function getAllowedWebOrigins(): ReadonlySet<string> {
  return new Set(
    (process.env.WEB_ORIGINS ?? 'http://localhost:3000,http://localhost:3001')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}
