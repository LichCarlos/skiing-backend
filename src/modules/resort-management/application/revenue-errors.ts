export class RevenueWriteConflictError extends Error {
  constructor() {
    super('Revenue changed concurrently; reload and retry');
  }
}
