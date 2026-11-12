import { ExactBusinessAnswer } from './exact-business-answer.js';
import type { ExactBusinessReader } from './ports/exact-business-reader.js';
import type { ChatModelProvider } from './ports/chat-model-provider.js';
import type { RagAccessPrincipal } from '../domain/rag-access.js';
const principal: RagAccessPrincipal = {
  userId: 1,
  active: true,
  merchantId: null,
  roles: [],
};
function setup(plan: unknown) {
  const fields = vi.fn().mockResolvedValue([
    {
      key: 'price',
      label: '价格',
      dataType: 'integer',
      searchable: false,
      filterable: true,
      sortable: true,
    },
  ]);
  const query = vi.fn().mockResolvedValue({
    items: [{ id: 1, title: '北山', fields: { price: 100 }, customFields: {} }],
    total: 3,
    asOf: '2026-11-05T00:00:00Z',
  });
  const stream = vi.fn(async function* () {
    yield JSON.stringify(plan);
  });
  return {
    service: new ExactBusinessAnswer(
      { fields, query } as unknown as ExactBusinessReader,
      { stream } as ChatModelProvider,
    ),
    query,
    stream,
  };
}
describe('exact AI query routing', () => {
  it('leaves knowledge questions on semantic RAG', async () => {
    const { service, stream } = setup({});
    expect(
      await service.prepare({ question: '如何犁式刹车', principal }),
    ).toBeNull();
    expect(stream).not.toHaveBeenCalled();
  });
  it('uses the SQL total instead of counting the displayed page', async () => {
    const { service, query } = setup({
      entity: 'ski_resort',
      operation: 'count',
      query: {},
    });
    const result = await service.prepare({
      question: '已发布雪场有多少家',
      principal,
    });
    let text = '';
    for await (const chunk of result!.stream) text += chunk;
    expect(text).toContain('共 3 条');
    expect(query).toHaveBeenCalledWith('ski_resort', { page: 1, pageSize: 1 });
    expect(result!.citations).toEqual([]);
  });
  it('does not query private revenue or contact details', async () => {
    const { service, query, stream } = setup({});
    const result = await service.prepare({
      question: '统计商家收益总数',
      principal,
    });
    expect(result).not.toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });
  it('rejects SQL/unknown plans without executing', async () => {
    const { service, query } = setup({
      entity: 'ski_resort',
      operation: 'list',
      query: { sql: 'select' },
    });
    await service.prepare({ question: '查询雪场价格排序', principal });
    expect(query).not.toHaveBeenCalled();
  });
  it('rechecks source visibility before committing an answer', async () => {
    const { service, query } = setup({
      entity: 'ski_resort',
      operation: 'list',
      query: { sort: { field: 'price', direction: 'asc' } },
    });
    const result = await service.prepare({
      question: '最便宜的雪场',
      principal,
    });
    query.mockResolvedValueOnce({ items: [], total: 0 });
    await expect(result!.assertEvidenceCurrent()).rejects.toThrow();
    expect(result!.citations[0]?.href).toBe('/resorts/1');
  });
  it('denies inactive principals', async () => {
    const { service, stream } = setup({});
    await expect(
      service.prepare({
        question: '雪场有多少家',
        principal: { ...principal, active: false },
      }),
    ).rejects.toThrow();
    expect(stream).not.toHaveBeenCalled();
  });
});
