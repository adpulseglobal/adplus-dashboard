declare module "pg" {
  export interface QueryResult<Row = Record<string, unknown>> {
    rows: Row[];
    rowCount: number | null;
  }
  export class Pool {
    constructor(options?: { connectionString?: string; max?: number; ssl?: boolean | { rejectUnauthorized?: boolean } });
    query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
  export interface PoolClient {
    query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
    release(): void;
  }
}
