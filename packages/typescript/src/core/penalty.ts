/**
 * Penalty system for abuse detection and progressive rate limiting.
 */

export interface PenaltyConfig {
    threshold: number;
    duration: number;
    multiplier: number;
    decayRate: number;
}

export interface Penalty {
    abuseScore: number;
    penaltyUntil: number | null;
    violations: number;
    lastViolation: number | null;
}

export class PenaltyManager {
    private config: PenaltyConfig;

    constructor(
        private store: any,
        config?: Partial<PenaltyConfig>
    ) {
        this.config = {
            threshold: config?.threshold ?? 10,
            duration: config?.duration ?? 3600,
            multiplier: config?.multiplier ?? 0.5,
            decayRate: config?.decayRate ?? 1.0,
        };
    }

    private getPenaltyKey(identifier: string): string {
        return `halt:penalty:${identifier}`;
    }

    async getPenalty(identifier: string): Promise<Penalty> {
        const key = this.getPenaltyKey(identifier);
        const stored = await this.store.get(key);

        if (!stored) {
            return {
                abuseScore: 0,
                penaltyUntil: null,
                violations: 0,
                lastViolation: null,
            };
        }

        const penalty: Penalty = {
            abuseScore: stored.abuseScore || 0,
            penaltyUntil: stored.penaltyUntil || null,
            violations: stored.violations || 0,
            lastViolation: stored.lastViolation || null,
        };

        // Apply decay to abuse score
        if (penalty.lastViolation) {
            const hoursElapsed = (Date.now() / 1000 - penalty.lastViolation) / 3600;
            const decay = hoursElapsed * this.config.decayRate;
            penalty.abuseScore = Math.max(0, penalty.abuseScore - decay);
        }

        return penalty;
    }

    async recordViolation(identifier: string, severity: number = 1.0): Promise<Penalty> {
        const penalty = await this.getPenalty(identifier);

        penalty.abuseScore += severity;
        penalty.violations += 1;
        penalty.lastViolation = Math.floor(Date.now() / 1000);

        // Check if penalty should be applied
        if (penalty.abuseScore >= this.config.threshold && !this.isActive(penalty)) {
            penalty.penaltyUntil = Math.floor(Date.now() / 1000) + this.config.duration;
        }

        await this.savePenalty(identifier, penalty);

        return penalty;
    }

    async applyPenalty(identifier: string, duration?: number): Promise<Penalty> {
        const penalty = await this.getPenalty(identifier);

        penalty.penaltyUntil =
            Math.floor(Date.now() / 1000) + (duration ?? this.config.duration);

        await this.savePenalty(identifier, penalty);

        return penalty;
    }

    async clearPenalty(identifier: string): Promise<void> {
        const key = this.getPenaltyKey(identifier);
        await this.store.delete(key);
    }

    getRateLimitMultiplier(penalty: Penalty): number {
        if (this.isActive(penalty)) {
            return this.config.multiplier;
        }
        return 1.0;
    }

    isActive(penalty: Penalty): boolean {
        if (!penalty.penaltyUntil) {
            return false;
        }
        return Math.floor(Date.now() / 1000) < penalty.penaltyUntil;
    }

    timeRemaining(penalty: Penalty): number {
        if (!this.isActive(penalty)) {
            return 0;
        }
        return (penalty.penaltyUntil || 0) - Math.floor(Date.now() / 1000);
    }

    private async savePenalty(identifier: string, penalty: Penalty): Promise<void> {
        const key = this.getPenaltyKey(identifier);
        const ttl = 7 * 24 * 3600; // 7 days

        await this.store.set(key, penalty, ttl);
    }
}

// Preset penalty configurations
export const PENALTY_LENIENT: PenaltyConfig = {
    threshold: 20,
    duration: 1800, // 30 minutes
    multiplier: 0.75,
    decayRate: 2.0,
};

export const PENALTY_MODERATE: PenaltyConfig = {
    threshold: 10,
    duration: 3600, // 1 hour
    multiplier: 0.5,
    decayRate: 1.0,
};

export const PENALTY_STRICT: PenaltyConfig = {
    threshold: 5,
    duration: 7200, // 2 hours
    multiplier: 0.25,
    decayRate: 0.5,
};
