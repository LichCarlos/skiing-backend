import { ApiProperty } from '@nestjs/swagger';
export class DashboardAccountCountsVO {
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 0 }) active!: number;
  @ApiProperty({ minimum: 0 }) disabled!: number;
}
export class DashboardResortCountsVO {
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 0 }) draft!: number;
  @ApiProperty({ minimum: 0 }) pendingReview!: number;
  @ApiProperty({ minimum: 0 }) published!: number;
  @ApiProperty({ minimum: 0 }) offline!: number;
}
export class DashboardArticleCountsVO {
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 0 }) draft!: number;
  @ApiProperty({ minimum: 0 }) published!: number;
  @ApiProperty({ minimum: 0 }) withdrawn!: number;
}
export class DashboardDynamicCountsVO {
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 0 }) pending!: number;
  @ApiProperty({ minimum: 0 }) published!: number;
  @ApiProperty({ minimum: 0 }) hidden!: number;
}
export class DashboardRagCountsVO {
  @ApiProperty({ minimum: 0 }) failed!: number;
}
export class DashboardRevenueVO {
  @ApiProperty({ type: String, pattern: '^\\d+\\.\\d{2}$', example: '0.00' })
  amount!: string;
  @ApiProperty({ enum: ['CNY'] }) currency!: 'CNY';
  @ApiProperty({ enum: ['all-time'] }) period!: 'all-time';
  @ApiProperty({ enum: ['all', 'merchant'] }) scope!: 'all' | 'merchant';
}
export class DashboardSummaryVO {
  @ApiProperty({ format: 'date-time' }) generatedAt!: string;
  @ApiProperty({ type: () => DashboardAccountCountsVO, nullable: true })
  users!: DashboardAccountCountsVO | null;
  @ApiProperty({ type: () => DashboardAccountCountsVO, nullable: true })
  merchants!: DashboardAccountCountsVO | null;
  @ApiProperty({ type: () => DashboardResortCountsVO, nullable: true })
  resorts!: DashboardResortCountsVO | null;
  @ApiProperty({ type: () => DashboardArticleCountsVO, nullable: true })
  articles!: DashboardArticleCountsVO | null;
  @ApiProperty({ type: () => DashboardDynamicCountsVO, nullable: true })
  dynamics!: DashboardDynamicCountsVO | null;
  @ApiProperty({ type: () => DashboardRagCountsVO, nullable: true })
  rag!: DashboardRagCountsVO | null;
  @ApiProperty({ type: () => DashboardRevenueVO, nullable: true })
  revenue!: DashboardRevenueVO | null;
}
