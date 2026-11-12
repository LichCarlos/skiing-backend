import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DynamicWriteDto, UpdateDynamicDto } from './community.dto.js';

describe('Community image count policy at HTTP boundary', () => {
  const imageAssetIds = Array.from({ length: 150 }, (_, i) => String(i + 1));
  it('accepts large create and update collections', async () => {
    for (const dto of [
      plainToInstance(DynamicWriteDto, { content: '雪', imageAssetIds }),
      plainToInstance(UpdateDynamicDto, { imageAssetIds }),
    ])
      expect(await validate(dto)).toEqual([]);
  });
  it('continues rejecting duplicate and malformed IDs', async () => {
    for (const values of [[...imageAssetIds, '1'], ['bad'], null]) {
      expect(
        await validate(
          plainToInstance(DynamicWriteDto, {
            content: '雪',
            imageAssetIds: values,
          }),
        ),
      ).not.toHaveLength(0);
    }
  });
});
