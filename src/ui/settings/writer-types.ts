/**
 * `SettingWriter` — published on day one (settings-redesign design doc §5.2),
 * before `context.ts`/`paths.ts` have any other content, so WP3's
 * `page-tool-permissions.ts` (`TOOL_POLICY_WRITERS`) and `page-vault-index.ts`
 * (`RAG_WRITERS`) can compile their contributions without depending on the
 * rest of the settings-UI package.
 *
 * Leaf module: imports only the `ObsidianGemini` plugin-surface interface.
 */

import type { ObsidianGemini } from '../../types/plugin';

/**
 * A write handler for a dotted settings path that needs more than the plain
 * assignment `writeSettingPath` performs — validation, side effects,
 * confirmation modals, or a non-scalar shape (`ragIndexing.excludeFolders`)
 * that a generic assignment would corrupt.
 *
 * Registered in `src/ui/settings/paths.ts#SETTING_WRITERS`, keyed by an exact
 * dotted path or a pattern with a single `*` wildcard segment (e.g.
 * `features.*.provider`). See the settings-redesign design doc §5.2 for the
 * longest-prefix matching rule.
 *
 * `needsUpdate: true` tells the setting tab to call `update()` (the
 * definitions tree's shape or a displayed value changed); `false` means
 * `refreshDomState()` is enough.
 */
export type SettingWriter = (plugin: ObsidianGemini, key: string, value: unknown) => Promise<{ needsUpdate: boolean }>;
