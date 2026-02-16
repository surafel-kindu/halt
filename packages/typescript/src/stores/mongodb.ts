/**
 * MongoDB storage backend for rate limiting.
 */

import { MongoClient, Db, Collection } from 'mongodb';

export interface MongoDBStoreOptions {
    connectionString: string;
    database?: string;
    collection?: string;
}

export class MongoDBStore {
    private client: MongoClient;
    private db!: Db;
    private collection!: Collection;
    private dbName: string;
    private collectionName: string;

    constructor(options: MongoDBStoreOptions) {
        this.client = new MongoClient(options.connectionString);
        this.dbName = options.database || 'halt';
        this.collectionName = options.collection || 'rate_limits';
        this.connect();
    }

    private async connect(): Promise<void> {
        await this.client.connect();
        this.db = this.client.db(this.dbName);
        this.collection = this.db.collection(this.collectionName);
        await this.ensureIndexes();
    }

    private async ensureIndexes(): Promise<void> {
        // Create TTL index for automatic expiration
        await this.collection.createIndex(
            { expiresAt: 1 },
            { expireAfterSeconds: 0, name: 'ttl_index' }
        );

        // Create index on key for fast lookups
        await this.collection.createIndex({ key: 1 }, { unique: true, name: 'key_index' });
    }

    async get(key: string): Promise<any> {
        const doc = await this.collection.findOne({
            key,
            expiresAt: { $gt: new Date() },
        });

        if (doc) {
            const state = doc.state;
            // Convert array back to object if needed
            if (Array.isArray(state) && state.length === 2) {
                return { tokens: state[0], lastRefill: state[1] };
            }
            return state;
        }

        return null;
    }

    async set(key: string, value: any, ttl: number = 3600): Promise<void> {
        const expiresAt = new Date(Date.now() + ttl * 1000);

        await this.collection.updateOne(
            { key },
            {
                $set: {
                    state: value,
                    expiresAt,
                    updatedAt: new Date(),
                },
            },
            { upsert: true }
        );
    }

    async delete(key: string): Promise<void> {
        await this.collection.deleteOne({ key });
    }

    async cleanupExpired(): Promise<number> {
        const result = await this.collection.deleteMany({
            expiresAt: { $lte: new Date() },
        });
        return result.deletedCount || 0;
    }

    async close(): Promise<void> {
        await this.client.close();
    }
}
