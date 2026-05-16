import {
	makeEnvSecretName,
	resolveServerEnv,
	writeServerEnv,
	clearServerEnv,
	migrateServerEnvToSecretStorage,
} from '../../src/mcp/mcp-secrets';
import { MCPServerConfig, MCP_TRANSPORT_STDIO } from '../../src/mcp/types';

// Mock Obsidian's App with a working SecretStorage backed by a Map.
function createMockApp() {
	const secrets = new Map<string, string>();
	return {
		secretStorage: {
			getSecret: vi.fn((id: string) => secrets.get(id) ?? null),
			setSecret: vi.fn((id: string, value: string) => {
				if (value === '') {
					secrets.delete(id);
				} else {
					secrets.set(id, value);
				}
			}),
			listSecrets: vi.fn(() => Array.from(secrets.keys())),
		},
	} as any;
}

function makeConfig(overrides?: Partial<MCPServerConfig>): MCPServerConfig {
	return {
		name: 'test-server',
		transport: MCP_TRANSPORT_STDIO,
		command: 'npx',
		args: [],
		enabled: true,
		trustedTools: [],
		...overrides,
	};
}

/** Attach a legacy plaintext `env` field (removed from the type) for migration tests. */
function withLegacyEnv(config: MCPServerConfig, env: unknown): MCPServerConfig {
	(config as { env?: unknown }).env = env;
	return config;
}

describe('makeEnvSecretName', () => {
	it('prefixes the key and includes the sanitized server name', () => {
		const key = makeEnvSecretName('My Server');
		expect(key.startsWith('mcp-env-my-server-')).toBe(true);
	});

	it('produces unique keys for the same name (random suffix)', () => {
		expect(makeEnvSecretName('foo')).not.toBe(makeEnvSecretName('foo'));
	});
});

describe('resolveServerEnv', () => {
	it('returns undefined when the config has no envSecretName', () => {
		const app = createMockApp();
		expect(resolveServerEnv(app, makeConfig())).toBeUndefined();
	});

	it('returns undefined when the referenced secret does not exist', () => {
		const app = createMockApp();
		expect(resolveServerEnv(app, makeConfig({ envSecretName: 'missing' }))).toBeUndefined();
	});

	it('parses and returns a stored env blob', () => {
		const app = createMockApp();
		app.secretStorage.setSecret('k', JSON.stringify({ API_KEY: 'abc', HOME: '/tmp' }));
		expect(resolveServerEnv(app, makeConfig({ envSecretName: 'k' }))).toEqual({ API_KEY: 'abc', HOME: '/tmp' });
	});

	it('returns undefined for an empty stored blob', () => {
		const app = createMockApp();
		app.secretStorage.setSecret('k', '{}');
		expect(resolveServerEnv(app, makeConfig({ envSecretName: 'k' }))).toBeUndefined();
	});

	it('returns undefined for a corrupt (unparseable) blob', () => {
		const app = createMockApp();
		app.secretStorage.setSecret('k', 'not-json{');
		expect(resolveServerEnv(app, makeConfig({ envSecretName: 'k' }))).toBeUndefined();
	});
});

describe('writeServerEnv', () => {
	it('generates an envSecretName and stores the blob on first write', () => {
		const app = createMockApp();
		const config = makeConfig();
		writeServerEnv(app, config, { TOKEN: 'xyz' });
		expect(config.envSecretName).toMatch(/^mcp-env-test-server-/);
		expect(resolveServerEnv(app, config)).toEqual({ TOKEN: 'xyz' });
	});

	it('reuses an existing envSecretName', () => {
		const app = createMockApp();
		const config = makeConfig({ envSecretName: 'existing-key' });
		writeServerEnv(app, config, { TOKEN: 'xyz' });
		expect(config.envSecretName).toBe('existing-key');
		expect(app.secretStorage.getSecret('existing-key')).toBe(JSON.stringify({ TOKEN: 'xyz' }));
	});

	it('clears the stored secret when env is emptied', () => {
		const app = createMockApp();
		const config = makeConfig();
		writeServerEnv(app, config, { TOKEN: 'xyz' });
		const key = config.envSecretName!;
		writeServerEnv(app, config, {});
		expect(app.secretStorage.getSecret(key)).toBeNull();
	});

	it('is a no-op when env is empty and no secret exists', () => {
		const app = createMockApp();
		const config = makeConfig();
		writeServerEnv(app, config, undefined);
		expect(config.envSecretName).toBeUndefined();
		expect(app.secretStorage.setSecret).not.toHaveBeenCalled();
	});

	it('round-trips through resolveServerEnv', () => {
		const app = createMockApp();
		const config = makeConfig();
		const env = { A: '1', B: '2' };
		writeServerEnv(app, config, env);
		expect(resolveServerEnv(app, config)).toEqual(env);
	});

	it('throws when a non-empty write cannot be verified', () => {
		const app = {
			secretStorage: {
				getSecret: vi.fn(() => null),
				setSecret: vi.fn(), // write silently fails — read-back will not match
			},
		} as any;
		expect(() => writeServerEnv(app, makeConfig(), { TOKEN: 'x' })).toThrow(/SecretStorage/);
	});
});

describe('clearServerEnv', () => {
	it('removes the stored secret', () => {
		const app = createMockApp();
		const config = makeConfig();
		writeServerEnv(app, config, { TOKEN: 'xyz' });
		const key = config.envSecretName!;
		clearServerEnv(app, config);
		expect(app.secretStorage.getSecret(key)).toBeNull();
	});

	it('is a no-op when the config has no envSecretName', () => {
		const app = createMockApp();
		expect(() => clearServerEnv(app, makeConfig())).not.toThrow();
		expect(app.secretStorage.setSecret).not.toHaveBeenCalled();
	});
});

describe('migrateServerEnvToSecretStorage', () => {
	it('returns false for an undefined server list', () => {
		expect(migrateServerEnvToSecretStorage(createMockApp(), undefined)).toBe(false);
	});

	it('returns false when no server carries a legacy env field', () => {
		expect(migrateServerEnvToSecretStorage(createMockApp(), [makeConfig()])).toBe(false);
	});

	it('moves a plaintext env into SecretStorage and drops the legacy field', () => {
		const app = createMockApp();
		const server = withLegacyEnv(makeConfig({ name: 'brave' }), { BRAVE_API_KEY: 'secret' });

		const changed = migrateServerEnvToSecretStorage(app, [server]);

		expect(changed).toBe(true);
		expect((server as { env?: unknown }).env).toBeUndefined();
		expect(server.envSecretName).toMatch(/^mcp-env-brave-/);
		expect(resolveServerEnv(app, server)).toEqual({ BRAVE_API_KEY: 'secret' });
	});

	it('drops a stray empty env field without creating a secret', () => {
		const app = createMockApp();
		const server = withLegacyEnv(makeConfig(), {});

		const changed = migrateServerEnvToSecretStorage(app, [server]);

		expect(changed).toBe(true);
		expect((server as { env?: unknown }).env).toBeUndefined();
		expect(server.envSecretName).toBeUndefined();
	});

	it('does not re-migrate a server that already has an envSecretName', () => {
		const app = createMockApp();
		const server = withLegacyEnv(makeConfig({ envSecretName: 'already-there' }), { K: 'v' });

		const changed = migrateServerEnvToSecretStorage(app, [server]);

		// The stray plaintext field is dropped, but the existing pointer is untouched.
		expect(changed).toBe(true);
		expect((server as { env?: unknown }).env).toBeUndefined();
		expect(server.envSecretName).toBe('already-there');
		expect(app.secretStorage.getSecret('already-there')).toBeNull();
	});

	it('keeps the plaintext and logs an error when verification fails', () => {
		const secrets = new Map<string, string>();
		const app = {
			secretStorage: {
				getSecret: vi.fn((id: string) => secrets.get(id) ?? null),
				setSecret: vi.fn(), // write silently fails — read-back will not match
			},
		} as any;
		const logger = { error: vi.fn() } as any;
		const server = withLegacyEnv(makeConfig({ name: 'flaky' }), { K: 'v' });

		const changed = migrateServerEnvToSecretStorage(app, [server], logger);

		expect(changed).toBe(false);
		expect((server as { env?: unknown }).env).toEqual({ K: 'v' });
		expect(server.envSecretName).toBeUndefined();
		expect(logger.error).toHaveBeenCalled();
	});
});
