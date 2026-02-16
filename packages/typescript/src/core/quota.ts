/**
 * Quota management for SaaS platforms.
 */

export enum QuotaPeriod {
    HOURLY = 'hourly',
    DAILY = 'daily',
    MONTHLY = 'monthly',
    YEARLY = 'yearly',
}

export interface Quota {
    name: string;
    limit: number;
    period: QuotaPeriod;
    currentUsage?: number;
    resetAt?: number;
}

export class QuotaManager {
    constructor(private store: any) { }

    private getQuotaKey(identifier: string, quotaName: string): string {
        return `halt:quota:${quotaName}:${identifier}`;
    }

    private calculateResetTime(period: QuotaPeriod): number {
        const now = new Date();

        switch (period) {
            case QuotaPeriod.HOURLY:
                const nextHour = new Date(now);
                nextHour.setHours(now.getHours() + 1, 0, 0, 0);
                return Math.floor(nextHour.getTime() / 1000);

            case QuotaPeriod.DAILY:
                const nextDay = new Date(now);
                nextDay.setDate(now.getDate() + 1);
                nextDay.setHours(0, 0, 0, 0);
                return Math.floor(nextDay.getTime() / 1000);

            case QuotaPeriod.MONTHLY:
                const nextMonth = new Date(now);
                if (now.getMonth() === 11) {
                    nextMonth.setFullYear(now.getFullYear() + 1, 0, 1);
                } else {
                    nextMonth.setMonth(now.getMonth() + 1, 1);
                }
                nextMonth.setHours(0, 0, 0, 0);
                return Math.floor(nextMonth.getTime() / 1000);

            case QuotaPeriod.YEARLY:
                const nextYear = new Date(now);
                nextYear.setFullYear(now.getFullYear() + 1, 0, 1);
                nextYear.setHours(0, 0, 0, 0);
                return Math.floor(nextYear.getTime() / 1000);

            default:
                throw new Error(`Invalid quota period: ${period}`);
        }
    }

    async getQuota(identifier: string, quota: Quota): Promise<Quota> {
        const key = this.getQuotaKey(identifier, quota.name);
        const stored = await this.store.get(key);

        if (!stored) {
            return {
                name: quota.name,
                limit: quota.limit,
                period: quota.period,
                currentUsage: 0,
                resetAt: this.calculateResetTime(quota.period),
            };
        }

        const currentQuota: Quota = {
            name: stored.name || quota.name,
            limit: stored.limit || quota.limit,
            period: stored.period || quota.period,
            currentUsage: stored.currentUsage || 0,
            resetAt: stored.resetAt,
        };

        // Check if quota period expired
        const now = Math.floor(Date.now() / 1000);
        if (currentQuota.resetAt && now >= currentQuota.resetAt) {
            currentQuota.currentUsage = 0;
            currentQuota.resetAt = this.calculateResetTime(currentQuota.period);
        }

        return currentQuota;
    }

    async checkQuota(
        identifier: string,
        quota: Quota,
        cost: number = 1
    ): Promise<{ allowed: boolean; quota: Quota }> {
        const currentQuota = await this.getQuota(identifier, quota);
        const allowed = (currentQuota.currentUsage || 0) + cost <= currentQuota.limit;

        return { allowed, quota: currentQuota };
    }

    async consumeQuota(identifier: string, quota: Quota, cost: number = 1): Promise<Quota> {
        const currentQuota = await this.getQuota(identifier, quota);

        currentQuota.currentUsage = (currentQuota.currentUsage || 0) + cost;

        const key = this.getQuotaKey(identifier, quota.name);
        const ttl = (currentQuota.resetAt || 0) - Math.floor(Date.now() / 1000) + 3600;

        await this.store.set(key, currentQuota, ttl);

        return currentQuota;
    }

    async resetQuota(identifier: string, quota: Quota): Promise<void> {
        const key = this.getQuotaKey(identifier, quota.name);
        await this.store.delete(key);
    }

    remaining(quota: Quota): number {
        return Math.max(0, quota.limit - (quota.currentUsage || 0));
    }

    isExceeded(quota: Quota): boolean {
        return (quota.currentUsage || 0) >= quota.limit;
    }
}

// Preset quotas
export const QUOTA_FREE_MONTHLY: Quota = {
    name: 'free_monthly_requests',
    limit: 10000,
    period: QuotaPeriod.MONTHLY,
};

export const QUOTA_PRO_MONTHLY: Quota = {
    name: 'pro_monthly_requests',
    limit: 100000,
    period: QuotaPeriod.MONTHLY,
};

export const QUOTA_ENTERPRISE_MONTHLY: Quota = {
    name: 'enterprise_monthly_requests',
    limit: 1000000,
    period: QuotaPeriod.MONTHLY,
};

export const QUOTA_FREE_DAILY: Quota = {
    name: 'free_daily_requests',
    limit: 500,
    period: QuotaPeriod.DAILY,
};

export const QUOTA_PRO_DAILY: Quota = {
    name: 'pro_daily_requests',
    limit: 5000,
    period: QuotaPeriod.DAILY,
};
