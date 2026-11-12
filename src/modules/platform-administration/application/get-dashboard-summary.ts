import { Inject, Injectable } from '@nestjs/common';
import {
  DASHBOARD_READER,
  type DashboardReader,
} from './ports/dashboard-reader.js';

@Injectable()
export class GetDashboardSummary {
  constructor(
    @Inject(DASHBOARD_READER) private readonly reader: DashboardReader,
  ) {}
  execute(actorUserId: number) {
    return this.reader.summarize(actorUserId);
  }
}
