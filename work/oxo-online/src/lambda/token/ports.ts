/**
 * ports.ts — DOMAIN-DEFINED ports (Cockburn). Interfaces in domain terms that
 * adapters implement. Domain code (handlers, authorizer) depends on these, NOT
 * on any SDK. Zero concrete imports here.
 *
 * UC1 (this engineer, A1) uses SecretSource. UC2 (A2) adds ConnectCounterPort
 * and GameLookupPort to this same module.
 */

/**
 * SecretSource — yields the shared HMAC-SHA256 secret used to mint/verify the
 * host wsToken. The concrete adapter (token/adapters/ssm-secret-source.ts)
 * reads it from SSM SecureString / Secrets Manager and module-caches it; the
 * domain only knows "give me the secret string".
 */
export interface SecretSource {
  get(): Promise<string>;
}
