export type SourceStateValue =
  | null
  | string
  | number
  | boolean
  | SourceStateValue[]
  | { [key: string]: SourceStateValue };
export type RagSourceState = { [key: string]: SourceStateValue };

// Increment when project publication checks change. SQL rejects older policy
// snapshots until the source adapter revalidates and reindexes the whole row.
export const PROJECT_RAG_POLICY_VERSION = 2;

// Only inputs used to render public RAG content belong in these snapshots.
export function resortSourceState(
  row: {
    Name: string;
    Province: string | null;
    City: string | null;
    District: string | null;
    Address: string | null;
    Price: number;
    OpenStatus: string;
    SnowCondition: string;
    OpeningHours: string | null;
    TrailSummary: string | null;
    FacilitySummary: string | null;
    Description: string;
    FitTags: { Item: { Value: string } }[];
    CustomFields?: unknown;
  },
  definitions: PublicFieldDefinition[] = [],
): RagSourceState {
  return {
    v: 2,
    kind: 'resort',
    fields: publicFieldState(row.CustomFields, definitions),
    Name: row.Name,
    Province: row.Province,
    City: row.City,
    District: row.District,
    Address: row.Address,
    Price: row.Price,
    OpenStatus: row.OpenStatus,
    SnowCondition: row.SnowCondition,
    OpeningHours: row.OpeningHours,
    TrailSummary: row.TrailSummary,
    FacilitySummary: row.FacilitySummary,
    Description: row.Description,
    tags: row.FitTags.map(({ Item }) => Item.Value).sort(compareCodePoints),
  };
}

export function articleSourceState(
  row: {
    Title: string;
    Summary: string;
    Body: string;
    CategoryValue: string;
    AuthorName: string | null;
    CustomFields: unknown;
  },
  definitions: PublicFieldDefinition[],
): RagSourceState {
  const fields = publicFieldState(row.CustomFields, definitions);
  return {
    v: 2,
    kind: 'article',
    Title: row.Title,
    Summary: row.Summary,
    Body: row.Body,
    CategoryValue: row.CategoryValue,
    AuthorName: row.AuthorName,
    fields,
  };
}

export function projectSourceState(row: {
  Title: string;
  Content: string;
  Category: string;
  SourceUrl: string | null;
}): RagSourceState {
  return {
    v: PROJECT_RAG_POLICY_VERSION,
    kind: 'project_doc',
    Title: row.Title,
    Content: row.Content,
    Category: row.Category,
    SourceUrl: row.SourceUrl,
  };
}

export function dynamicSourceState(
  row: {
    Content: string;
    Author: { Nickname: string };
    Resort: { Name: string } | null;
    CustomFields?: unknown;
  },
  definitions: PublicFieldDefinition[] = [],
): RagSourceState {
  return {
    v: 2,
    kind: 'dynamic',
    fields: publicFieldState(row.CustomFields, definitions),
    Content: row.Content,
    Nickname: row.Author.Nickname,
    ResortName: row.Resort?.Name ?? null,
  };
}

export function dictionarySourceState(
  dictType: string,
  dictName: string,
  value: string,
  breadcrumb: { ItemId: number; ParentId: number | null; Label: string }[],
): RagSourceState {
  return {
    v: 1,
    kind: 'dictionary',
    DictType: dictType,
    DictName: dictName,
    Value: value,
    breadcrumb: breadcrumb.map(({ ItemId, ParentId, Label }) => ({
      ItemId,
      ParentId,
      Label,
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStateValue(value: unknown): SourceStateValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(toStateValue);
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, toStateValue(nested)]),
    );
  throw new TypeError('RAG source state must contain JSON values');
}

// Matches PostgreSQL COLLATE "C", including supplementary Unicode characters.
function compareCodePoints(a: string, b: string): number {
  const left = Array.from(a, (point) => point.codePointAt(0)!);
  const right = Array.from(b, (point) => point.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  }
  return left.length - right.length;
}

export interface PublicFieldDefinition {
  FieldKey: string;
  Label: string;
  OptionsType?: { Items: { Value: string; Label: string }[] } | null;
}
export function publicFieldState(
  value: unknown,
  definitions: PublicFieldDefinition[],
): SourceStateValue[] {
  const values = isRecord(value) ? value : {};
  return [...definitions]
    .sort((a, b) => compareCodePoints(a.FieldKey, b.FieldKey))
    .flatMap((f) =>
      Object.hasOwn(values, f.FieldKey)
        ? [
            {
              key: f.FieldKey,
              label: f.Label,
              value: toStateValue(values[f.FieldKey]),
              options: (f.OptionsType?.Items ?? [])
                .map((i) => ({ value: i.Value, label: i.Label }))
                .sort((a, b) => compareCodePoints(a.value, b.value)),
            },
          ]
        : [],
    );
}
