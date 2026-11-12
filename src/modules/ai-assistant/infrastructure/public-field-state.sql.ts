import { Prisma } from '@prisma/client';
// Correlated aliases originate only from the fixed callers below.
export function publicFieldStateSql(
  entity: string,
  alias: 'r' | 'a' | 'd',
): Prisma.Sql {
  const values = Prisma.raw(alias + '."CustomFields"');
  return Prisma.sql`COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'key', f."FieldKey", 'label', f."Label", 'value', ${values}->f."FieldKey",
    'options', COALESCE((SELECT jsonb_agg(jsonb_build_object('value',i."Value",'label',i."Label") ORDER BY i."Value" COLLATE "C") FROM "DictionaryItem" i WHERE i."DictType"=f."OptionsDictType" AND i."Status"='active'),'[]'::jsonb)
  ) ORDER BY f."FieldKey" COLLATE "C") FROM "CustomFieldDefinition" f JOIN "CustomFieldGroup" g ON g."EntityType"=f."EntityType" AND g."GroupKey"=f."GroupKey"
  WHERE f."EntityType"=${entity} AND f."Status"='active' AND f."IsPublic"=true AND g."Status"='active'
    AND (f."OptionsDictType" IS NULL OR EXISTS (SELECT 1 FROM "DictionaryType" t WHERE t."DictType"=f."OptionsDictType" AND t."Status"='active' AND t."PubliclyReadable"=true))
    AND jsonb_typeof(${values})='object' AND ${values} ? f."FieldKey"),'[]'::jsonb)`;
}
