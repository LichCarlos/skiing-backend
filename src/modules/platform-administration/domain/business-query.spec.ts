import { normalizeBusinessQuery, type QueryField } from './business-query.js';
const fields: QueryField[] = [
  {
    key: 'price',
    label: '价格',
    dataType: 'integer',
    searchable: false,
    filterable: true,
    sortable: true,
  },
  {
    key: 'custom.terrain',
    label: '地形',
    dataType: 'multi_select',
    searchable: false,
    filterable: true,
    sortable: false,
  },
  {
    key: 'custom.note',
    label: '说明',
    dataType: 'text',
    searchable: true,
    filterable: true,
    sortable: false,
  },
];
describe('public business query rules', () => {
  it('retains typed false/zero and deterministic pagination', () => {
    expect(
      normalizeBusinessQuery(
        {
          filters: [{ field: 'price', op: 'gte', value: 0 }],
          sort: { field: 'price', direction: 'asc' },
        },
        fields,
      ),
    ).toMatchObject({ page: 1, pageSize: 20, filters: [{ value: 0 }] });
  });
  it.each([
    { sql: 'DROP TABLE' },
    { page: 0 },
    { pageSize: 101 },
    { filters: [{ field: 'private', op: 'eq', value: 'secret' }] },
    { filters: [{ field: 'price', op: 'eq', value: '0' }] },
    { filters: [{ field: 'price', op: 'contains', value: 1 }] },
    { filters: [{ field: 'custom.terrain', op: 'eq', value: 'blue' }] },
    { sort: { field: 'custom.note', direction: 'asc' } },
    { sort: { field: 'price;DELETE', direction: 'asc' } },
    {
      filters: Array.from({ length: 21 }, () => ({
        field: 'price',
        op: 'eq',
        value: 1,
      })),
    },
  ])('rejects unsupported query %j', (input) =>
    expect(() => normalizeBusinessQuery(input, fields)).toThrow(RangeError),
  );
  it('supports public multiselect containment and literal text search', () =>
    expect(
      normalizeBusinessQuery(
        {
          filters: [
            { field: 'custom.terrain', op: 'has', value: 'blue' },
            { field: 'custom.note', op: 'contains', value: '%_雪' },
          ],
        },
        fields,
      ).filters,
    ).toHaveLength(2));
});
