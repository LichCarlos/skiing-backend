import { ApiProperty } from '@nestjs/swagger';

export class RevenueCreatorVO {
  @ApiProperty()
  userId!: number;

  @ApiProperty()
  nickname!: string;
}

export class RevenueRecordVO {
  @ApiProperty()
  revenueId!: number;

  @ApiProperty()
  resortId!: number;

  @ApiProperty()
  resortName!: string;

  @ApiProperty({ format: 'date' })
  reportDate!: string;

  @ApiProperty({ type: String, example: '12345.67' })
  revenueAmount!: string;

  @ApiProperty({ enum: ['manual', 'import'] })
  source!: string;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: () => RevenueCreatorVO })
  createdBy!: RevenueCreatorVO;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class RevenuePageVO {
  @ApiProperty({ type: () => RevenueRecordVO, isArray: true })
  items!: RevenueRecordVO[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  hasNext!: boolean;
}

export class RevenueRequestResultVO {
  @ApiProperty() revenueId!: number;
  @ApiProperty() resortId!: number;
  @ApiProperty({ format: 'date' }) reportDate!: string;
  @ApiProperty({ type: String }) revenueAmount!: string;
  @ApiProperty({ enum: ['manual', 'import'] }) source!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class RevenueRequestVO {
  @ApiProperty({ format: 'uuid' }) requestId!: string;
  @ApiProperty({ enum: ['completed'] }) status!: 'completed';
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) completedAt!: string;
  @ApiProperty({ type: () => RevenueRequestResultVO })
  result!: RevenueRequestResultVO;
}

export class RevenueDailyVO {
  @ApiProperty({ format: 'date' })
  date!: string;

  @ApiProperty({ type: String, example: '12345.67' })
  amount!: string;
}

export class RevenueSummaryVO {
  @ApiProperty({ type: Number, nullable: true })
  resortId!: number | null;

  @ApiProperty({ type: String, nullable: true })
  resortName!: string | null;

  @ApiProperty({ format: 'date' })
  fromDate!: string;

  @ApiProperty({ format: 'date' })
  toDate!: string;

  @ApiProperty({ type: String, example: '12345.67' })
  totalAmount!: string;

  @ApiProperty({ type: () => RevenueDailyVO, isArray: true })
  daily!: RevenueDailyVO[];
}

export class RevenueImportRowResultVO {
  @ApiProperty()
  rowNumber!: number;

  @ApiProperty()
  success!: boolean;

  @ApiProperty({ type: Number, nullable: true })
  revenueId!: number | null;

  @ApiProperty({ type: String, nullable: true })
  error!: string | null;
}

export class RevenueImportResultVO {
  @ApiProperty()
  totalRows!: number;

  @ApiProperty()
  succeededRows!: number;

  @ApiProperty()
  failedRows!: number;

  @ApiProperty({ type: () => RevenueImportRowResultVO, isArray: true })
  results!: RevenueImportRowResultVO[];
}

export class RevenueImportJobVO {
  @ApiProperty({ format: 'uuid' }) jobId!: string;
  @ApiProperty({ enum: ['pending', 'processing', 'completed', 'failed'] })
  status!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty() totalRows!: number;
  @ApiProperty() processedRows!: number;
  @ApiProperty() succeededRows!: number;
  @ApiProperty() failedRows!: number;
  @ApiProperty({ type: () => RevenueImportResultVO, nullable: true })
  result!: RevenueImportResultVO | null;
}
