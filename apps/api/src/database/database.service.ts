import { Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import { Pool, type PoolClient, type QueryResult } from "pg";

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required to start the API.");
    this.pool = new Pool({ connectionString, max: 10, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined });
  }

  async onModuleInit(): Promise<void> {
    try { await this.pool.query("SELECT 1"); }
    catch { throw new Error("PostgreSQL is unavailable. Check DATABASE_URL and run `npm run db:migrate` before starting the API."); }
  }

  async onModuleDestroy(): Promise<void> { await this.pool.end(); }

  query<Row = Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<QueryResult<Row>> {
    return this.pool.query<Row>(text, values);
  }

  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
