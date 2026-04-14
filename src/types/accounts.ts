export interface AccountBudget {
  warn_usd?: number;
  halt_usd?: number;
  period?: 'monthly' | 'weekly' | 'daily';
}

export interface Account {
  description?: string;
  credential_store: 'keychain';
  keychain_service: string;
  budget?: AccountBudget;
}

export interface AccountsConfig {
  version: string;
  accounts: Record<string, Account>;
}

export interface AccountCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string | number;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
}
