import { describe, expect, it } from 'vitest';
import {
  articleSourceState,
  dictionarySourceState,
  dynamicSourceState,
  projectSourceState,
  resortSourceState,
} from './rag-source-state.js';

describe('public RAG source snapshots', () => {
  it('includes only public existing article fields and compares falsy/JSON values exactly', () => {
    const row = {
      Title: '指南',
      Summary: '',
      Body: '正文',
      CategoryValue: 'basics',
      AuthorName: null,
      CustomFields: { private: 'secret', z: false, a: [0, null, '雪'] },
    };
    const state = articleSourceState(row, [
      { FieldKey: 'z', Label: 'Z' },
      { FieldKey: 'missing', Label: 'Missing' },
      { FieldKey: 'a', Label: 'A' },
    ]);
    expect(state.fields).toEqual([
      { key: 'a', label: 'A', value: [0, null, '雪'], options: [] },
      { key: 'z', label: 'Z', value: false, options: [] },
    ]);
    expect(JSON.stringify(state)).not.toContain('secret');
    expect(articleSourceState({ ...row, CustomFields: [] }, []).fields).toEqual(
      [],
    );
    expect(
      articleSourceState(row, [{ FieldKey: 'a', Label: '改名' }]),
    ).not.toEqual(state);
  });

  it('keeps dictionary ancestry identity and ordering without unrelated properties', () => {
    const breadcrumb = [
      { ItemId: 1, ParentId: null, Label: '初级', private: 'secret' },
      { ItemId: 2, ParentId: 1, Label: '转弯', private: 'secret' },
    ];
    const state = dictionarySourceState('skill', '技能', 'turn', breadcrumb);
    expect(state.breadcrumb).toEqual([
      { ItemId: 1, ParentId: null, Label: '初级' },
      { ItemId: 2, ParentId: 1, Label: '转弯' },
    ]);
    expect(JSON.stringify(state)).not.toContain('secret');
    expect(
      dictionarySourceState('skill', '技能', 'turn', [...breadcrumb].reverse()),
    ).not.toEqual(state);
  });

  it('captures dynamic dependencies and project content changes without timestamps', () => {
    const row = {
      Content: '雪况好',
      Author: { Nickname: '雪友' },
      Resort: { Name: '北山' },
    };
    const state = dynamicSourceState(row);
    expect(
      dynamicSourceState({ ...row, Author: { Nickname: '新昵称' } }),
    ).not.toEqual(state);
    expect(dynamicSourceState({ ...row, Resort: null }).ResortName).toBeNull();
    const project = {
      Title: '规则',
      Content: '旧条款',
      Category: 'faq',
      SourceUrl: null,
    };
    expect(projectSourceState({ ...project, Content: '新条款' })).not.toEqual(
      projectSourceState(project),
    );
  });

  it('sorts resort tags as PostgreSQL C collation while retaining each public content dependency', () => {
    const row = {
      Name: '北山',
      Province: null,
      City: null,
      District: null,
      Address: null,
      Price: 100,
      OpenStatus: 'open',
      SnowCondition: 'powder',
      OpeningHours: null,
      TrailSummary: null,
      FacilitySummary: null,
      Description: '初学者',
      FitTags: ['😀', '\uE000', 'a'].map((Value) => ({ Item: { Value } })),
    };
    const state = resortSourceState(row);
    expect(state.tags).toEqual(['a', '\uE000', '😀']);
    expect(
      resortSourceState({ ...row, FitTags: [...row.FitTags].reverse() }),
    ).toEqual(state);
    expect(resortSourceState({ ...row, Price: 101 })).not.toEqual(state);
  });
});
