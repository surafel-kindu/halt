/**
 * DynamoDB storage backend for rate limiting.
 */

import {
    DynamoDBClient,
    PutItemCommand,
    GetItemCommand,
    DeleteItemCommand,
    UpdateTimeToLiveCommand,
    DescribeTableCommand,
    CreateTableCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

export interface DynamoDBStoreOptions {
    tableName: string;
    region?: string;
    endpoint?: string;
}

export class DynamoDBStore {
    private client: DynamoDBClient;
    private tableName: string;

    constructor(options: DynamoDBStoreOptions) {
        this.tableName = options.tableName;

        const clientConfig: any = {
            region: options.region || 'us-east-1',
        };

        if (options.endpoint) {
            clientConfig.endpoint = options.endpoint;
        }

        this.client = new DynamoDBClient(clientConfig);
        this.ensureTable();
    }

    private async ensureTable(): Promise<void> {
        try {
            await this.client.send(
                new DescribeTableCommand({ TableName: this.tableName })
            );
        } catch (error: any) {
            if (error.name === 'ResourceNotFoundException') {
                // Create table
                await this.client.send(
                    new CreateTableCommand({
                        TableName: this.tableName,
                        KeySchema: [{ AttributeName: 'key', KeyType: 'HASH' }],
                        AttributeDefinitions: [{ AttributeName: 'key', AttributeType: 'S' }],
                        BillingMode: 'PAY_PER_REQUEST',
                    })
                );

                // Enable TTL
                await this.client.send(
                    new UpdateTimeToLiveCommand({
                        TableName: this.tableName,
                        TimeToLiveSpecification: {
                            Enabled: true,
                            AttributeName: 'ttl',
                        },
                    })
                );
            }
        }
    }

    async get(key: string): Promise<any> {
        const result = await this.client.send(
            new GetItemCommand({
                TableName: this.tableName,
                Key: marshall({ key }),
            })
        );

        if (result.Item) {
            const item = unmarshall(result.Item);

            // Check if expired
            if (item.ttl && item.ttl <= Math.floor(Date.now() / 1000)) {
                return null;
            }

            return item.state;
        }

        return null;
    }

    async set(key: string, value: any, ttl: number = 3600): Promise<void> {
        const ttlTimestamp = Math.floor(Date.now() / 1000) + ttl;

        await this.client.send(
            new PutItemCommand({
                TableName: this.tableName,
                Item: marshall({
                    key,
                    state: value,
                    ttl: ttlTimestamp,
                }),
            })
        );
    }

    async delete(key: string): Promise<void> {
        await this.client.send(
            new DeleteItemCommand({
                TableName: this.tableName,
                Key: marshall({ key }),
            })
        );
    }

    async cleanupExpired(): Promise<number> {
        // DynamoDB TTL handles cleanup automatically
        return 0;
    }

    async close(): Promise<void> {
        this.client.destroy();
    }
}
