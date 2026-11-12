export interface ApiResponse<T> {
  code: number;
  msg: string;
  data: T;
  traceId: string;
}

export interface ApiErrorDetail {
  field?: string;
  code: string;
  message: string;
}

export interface ApiErrorResponse {
  code: number;
  msg: string;
  data: null;
  traceId: string;
  details?: ApiErrorDetail[];
}
