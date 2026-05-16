import type { App } from 'obsidian';
import type { Logger } from '../utils/logger';
import type { MCPServerConfig } from './types';
import { sanitizeKeySegment } from './mcp-oauth-provider';

/** Prefix for SecretStorage keys holding stdio MCP server environment variables. */
const SECRET_KEY_ENV_PREFIX = 'mcp-env-';

/**
 * Generate a SecretStorage key for a server's environment-variable blob. The
 * random suffix keeps keys unique even when two distinct server names sanitize
 * to the same segment — it is a key disambiguator, not a security boundary.
 */
export function makeEnvSecretName(serverName: string): string {
	const suffix = crypto.randomUUID().slice(0, 8);
	return `${SECRET_KEY_ENV_PREFIX}${sanitizeKeySegment(serverName)}-${suffix}`;
}

/**
 * Read a stdio MCP server's environment variables from Obsidian's SecretStorage
 * (OS keychain). Returns undefined when none are stored or the stored blob is
 * empty or unparseable.
 */
export function resolveServerEnv(app: App, config: MCPServerConfig): Record<string, string> | undefined {
	if (!config.envSecretName) return undefined;
	const raw = app.secretStorage.getSecret(config.envSecretName);
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw) as Record<string, string>;
		if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
			return parsed;
		}
	} catch {
		// Corrupt blob — treat as no env rather than failing the connection.
	}
	return undefined;
}

/**
 * Persist a stdio MCP server's environment variables to SecretStorage, keeping
 * them out of data.json. Mutates `config.envSecretName`, generating a key on
 * first write. An empty or undefined env clears any previously stored secret.
 */
export function writeServerEnv(app: App, config: MCPServerConfig, env: Record<string, string> | undefined): void {
	const hasEnv = !!env && Object.keys(env).length > 0;
	if (!hasEnv) {
		if (config.envSecretName) {
			app.secretStorage.setSecret(config.envSecretName, '');
		}
		return;
	}
	if (!config.envSecretName) {
		config.envSecretName = makeEnvSecretName(config.name);
	}
	app.secretStorage.setSecret(config.envSecretName, JSON.stringify(env));
}

/**
 * Clear a server's stored env secret. Called when a server is deleted so its
 * credentials do not linger in the keychain.
 */
export function clearServerEnv(app: App, config: MCPServerConfig): void {
	if (config.envSecretName) {
		app.secretStorage.setSecret(config.envSecretName, '');
	}
}

/**
 * One-time migration: move any plaintext `env` objects on MCP server configs
 * (legacy data.json storage) into SecretStorage. Mutates each migrated config —
 * sets `envSecretName`, deletes the legacy `env` field. Returns true when at
 * least one config changed, signalling the caller to persist settings.
 *
 * Each migration is verified (the read-back must match) before the plaintext is
 * dropped; on mismatch the plaintext is kept and an error is logged.
 */
export function migrateServerEnvToSecretStorage(
	app: App,
	servers: MCPServerConfig[] | undefined,
	logger?: Logger
): boolean {
	if (!Array.isArray(servers)) return false;
	let changed = false;
	for (const server of servers) {
		const legacyEnv = (server as { env?: unknown }).env;
		if (legacyEnv === undefined) continue;

		const entries =
			legacyEnv && typeof legacyEnv === 'object' ? Object.entries(legacyEnv as Record<string, string>) : [];

		if (entries.length > 0 && !server.envSecretName) {
			const secretName = makeEnvSecretName(server.name);
			const blob = JSON.stringify(legacyEnv);
			app.secretStorage.setSecret(secretName, blob);
			if (app.secretStorage.getSecret(secretName) === blob) {
				server.envSecretName = secretName;
				delete (server as { env?: unknown }).env;
				changed = true;
			} else {
				logger?.error(
					`MCP env migration failed for "${server.name}": SecretStorage verification mismatch, keeping plaintext`
				);
			}
		} else {
			// Empty env, or a secret pointer already exists — drop the stray plaintext field.
			delete (server as { env?: unknown }).env;
			changed = true;
		}
	}
	return changed;
}
