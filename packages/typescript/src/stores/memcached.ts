/**
 * Memcached storage backend for rate limiting.
 */

import Memcached from 'memcached';

export interface MemcachedStoreOptions {
    servers: string | string[];
    options?: Memcached.options;
}

export class MemcachedStore {
    private client: Memcached;

    constructor(options: MemcachedStoreOptions) {
        this.client = new Memcached(options.servers, options.options);
    }

    async get(key: string): Promise<any> {
        return new Promise((resolve, reject) => {
            this.client.get(key, (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(data || null);
                }
            });
        });
    }

    async set(key: string, value: any, ttl: number = 3600): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client.set(key, value, ttl, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    async delete(key: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client.del(key, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    async gets(key: string): Promise<{ value: any; cas: string } | null> {
        return new Promise((resolve, reject) => {
            this.client.gets(key, (err, data) => {
                if (err) {
                    reject(err);
                } else if (data) {
                    resolve({ value: data, cas: data.cas });
                } else {
                    resolve(null);
                }
            });
        });
    }

    async cas(key: string, value: any, cas: string, ttl: number = 3600): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.client.cas(key, value, cas, ttl, (err, result) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });
    }

    async cleanupExpired(): Promise<number> {
        // Memcached handles expiration automatically
        return 0;
    }

    async close(): Promise<void> {
        this.client.end();
    }
}
