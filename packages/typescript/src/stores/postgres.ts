/**
 * PostgreSQL storage backend for rate limiting.
 */

import { Pool, PoolConfig } from 'pg';

export interface PostgresStoreOptions extends PoolConfig {
    tableName?: string;
}

export class PostgresStore {
    private pool: Pool;
    private tableName: string;

    constructor(options: PostgresStoreOptions) {
        const { tableName = 'rate_limit_state', ...poolConfig } = options;
        this.tableName = tableName;
        this.pool = new Pool(poolConfig);
        this.ensureTable();
    }

    private async ensureTable(): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          key VARCHAR(255) PRIMARY KEY,
          state JSONB NOT NULL,
          expires_at BIGINT NOT NULL
        )
      `);

            await client.query(`
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_expires_at
        ON ${this.tableName}(expires_at)
      `);
        } finally {
            client.release();
        }
    }

    async get(key: string): Promise<any> {
        const now = Math.floor(Date.now() / 1000);
        const client = await this.pool.connect();

        try {
            const result = await client.query(
                `SELECT state FROM ${this.tableName}
         WHERE key = $1 AND expires_at > $2`,
                [key, now]
            );

            if (result.rows.length > 0) {
                const state = result.rows[0].state;
                // Convert array back to object if needed
                if (Array.isArray(state) && state.length === 2) {
                    return { tokens: state[0], lastRefill: state[1] };
                }
                return state;
            }

            return null;
        } finally {
            client.release();
        }
    }

    async set(key: string, value: any, ttl: number = 3600): Promise<void> {
        const expiresAt = Math.floor(Date.now() / 1000) + ttl;
        const client = await this.pool.connect();

        try {
            await client.query(
                `INSERT INTO ${this.tableName} (key, state, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE
         SET state = EXCLUDED.state, expires_at = EXCLUDED.expires_at`,
                [key, JSON.stringify(value), expiresAt]
            );
        } finally {
            client.release();
        }
    }

    async delete(key: string): Promise<void> {
        const client = await this.pool.connect();

        try {
            await client.query(`DELETE FROM ${this.tableName} WHERE key = $1`, [key]);
        } finally {
            client.release();
        }
    }

    async cleanupExpired(): Promise<number> {
        const now = Math.floor(Date.now() / 1000);
        const client = await this.pool.connect();

        try {
            const result = await client.query(
                `DELETE FROM ${this.tableName} WHERE expires_at <= $1`,
                [now]
            );
            return result.rowCount || 0;
        } finally {
            client.release();
        }
    }

    async close(): Promise<void> {
        await this.pool.end();
    }
}
