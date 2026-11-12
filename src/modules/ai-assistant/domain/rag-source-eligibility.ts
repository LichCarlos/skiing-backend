interface PublicRecord {
  status: string;
  deletedAt: Date | null;
}
export function isPublicRagRecord(record: PublicRecord | null): boolean {
  return !!record && record.status === 'published' && record.deletedAt === null;
}
export function isPublicPublishedRagRecord(
  record: (PublicRecord & { publishedAt: Date | null }) | null,
): boolean {
  return isPublicRagRecord(record) && record?.publishedAt instanceof Date;
}
