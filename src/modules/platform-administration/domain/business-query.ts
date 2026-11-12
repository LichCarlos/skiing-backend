export const BUSINESS_ENTITIES = ['ski_resort', 'article', 'dynamic'] as const;
export type BusinessEntity = (typeof BUSINESS_ENTITIES)[number];
export type QueryValue = string | number | boolean | null;
export interface BusinessQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  filters?: {
    field: string;
    op: 'eq' | 'contains' | 'gte' | 'lte' | 'has';
    value: QueryValue;
  }[];
  sort?: { field: string; direction: 'asc' | 'desc' };
}
export interface QueryField {
  key: string;
  label: string;
  dataType: string;
  searchable: boolean;
  filterable: boolean;
  sortable: boolean;
  builtin?: boolean;
  options?: { value: string; label: string }[];
}
export function normalizeBusinessQuery(
  value: unknown,
  fields: readonly QueryField[],
) {
  if (
    !record(value) ||
    Object.keys(value).some(
      (k) => !['page', 'pageSize', 'keyword', 'filters', 'sort'].includes(k),
    )
  )
    throw new RangeError('Unknown query property');
  const input = value as BusinessQuery;
  const page = input.page ?? 1,
    pageSize = input.pageSize ?? 20;
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    (page - 1) * pageSize > 2147483647
  )
    throw new RangeError('Invalid pagination');
  if (
    input.keyword !== undefined &&
    (typeof input.keyword !== 'string' || input.keyword.length > 200)
  )
    throw new RangeError('Invalid keyword');
  const filters = input.filters ?? [];
  if (!Array.isArray(filters) || filters.length > 20)
    throw new RangeError('Invalid filters');
  for (const filter of filters) {
    if (
      !record(filter) ||
      Object.keys(filter).some((k) => !['field', 'op', 'value'].includes(k))
    )
      throw new RangeError('Invalid filter');
    const field = fields.find((f) => f.key === filter.field && f.filterable);
    if (!field || !['eq', 'contains', 'gte', 'lte', 'has'].includes(filter.op))
      throw new RangeError('Field is unavailable for filtering');
    const number = ['integer', 'decimal'].includes(field.dataType);
    if (
      number &&
      (typeof filter.value !== 'number' ||
        !Number.isFinite(filter.value) ||
        (field.dataType === 'integer' && !Number.isSafeInteger(filter.value)))
    )
      throw new RangeError('Invalid numeric filter');
    if (field.dataType === 'boolean' && typeof filter.value !== 'boolean')
      throw new RangeError('Invalid boolean filter');
    if (
      !number &&
      field.dataType !== 'boolean' &&
      (typeof filter.value !== 'string' || filter.value.length > 200)
    )
      throw new RangeError('Invalid text filter');
    if (
      ['single_select', 'multi_select'].includes(field.dataType) &&
      field.options &&
      !field.options.some((option) => option.value === filter.value)
    )
      throw new RangeError('Invalid public option');
    if (
      field.dataType === 'date' &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(String(filter.value)) ||
        !Number.isFinite(Date.parse(String(filter.value))) ||
        new Date(String(filter.value)).toISOString().slice(0, 10) !==
          filter.value)
    )
      throw new RangeError('Invalid date filter');
    if (
      filter.op === 'contains' &&
      (!field.searchable ||
        !['text', 'textarea', 'url'].includes(field.dataType))
    )
      throw new RangeError('Field is unavailable for search');
    if (
      ['gte', 'lte'].includes(filter.op) &&
      !number &&
      field.dataType !== 'date'
    )
      throw new RangeError('Field is unavailable for range filters');
    if ((filter.op === 'has') !== (field.dataType === 'multi_select'))
      throw new RangeError('Multi-select fields require has');
  }
  if (input.sort !== undefined) {
    if (
      !record(input.sort) ||
      Object.keys(input.sort).some(
        (k) => !['field', 'direction'].includes(k),
      ) ||
      !['asc', 'desc'].includes(input.sort.direction) ||
      !fields.some(
        (f) =>
          f.key === input.sort?.field &&
          f.sortable &&
          f.dataType !== 'multi_select',
      )
    )
      throw new RangeError('Field is unavailable for sorting');
  }
  return {
    page,
    pageSize,
    keyword: input.keyword?.trim(),
    filters,
    sort: input.sort,
  };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
