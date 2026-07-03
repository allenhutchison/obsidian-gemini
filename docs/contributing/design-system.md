# Design system

Gemini Scribe's UI is theme-adaptive by default: it should feel native inside any
Obsidian theme — light, dark, or custom. The design system is a thin **semantic
token layer** (in `styles.css`) that aliases Obsidian's own theme variables, plus a
handful of plugin-owned scales (spacing, radius, icon, motion) and one Gemini brand
accent. Cohesion comes from consistent tokens, not from hardcoded color.

**Living references** (design-only; the code here is the source of truth):

- Style-guide artifact — every token + component, with a light/dark toggle:
  <https://claude.ai/code/artifact/e6ffa1ed-4d9c-40a0-b283-1871329f7b74>
- Claude Design project — design new plugin UI on-brand:
  <https://claude.ai/design/p/3548c278-5c28-47ec-a189-df9f1616f588>

## The token layer

Defined once at the top of `styles.css` under **`body`** (not `:root`). Obsidian's
theme variables are scoped to `body.theme-light` / `body.theme-dark`, so a token
that aliases one from `:root` — where the source is undefined — resolves to an
invalid value. `body` is the highest scope where the aliases actually resolve.
Prefer these tokens over raw `var(--obsidian-var)` references or magic numbers when
writing or migrating styles.

| Group     | Tokens                                                              | Aliases                                                                         |
| --------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Surfaces  | `--gs-surface`, `--gs-surface-alt`, `--gs-hover`                    | `--background-primary`, `--background-secondary`, `--background-modifier-hover` |
| Text      | `--gs-text`, `--gs-text-muted`, `--gs-text-faint`, `--gs-on-accent` | `--text-normal`, `--text-muted`, `--text-faint`, `--text-on-accent`             |
| Lines     | `--gs-border`, `--gs-border-strong`                                 | `--background-modifier-border`, `…-border-hover`                                |
| Accent    | `--gs-accent`, `--gs-accent-hover`                                  | `--interactive-accent`, `--interactive-accent-hover`                            |
| Brand     | `--gs-brand-gradient` (+ `--gs-brand-1/-2/-3`)                      | Gemini gradient — **primary action & brand only**                               |
| Status    | `--gs-success`, `--gs-warning`, `--gs-error`, `--gs-info`           | `--color-green/-orange/-red/-blue`                                              |
| Spacing   | `--gs-space-1..8`                                                   | 4 / 8 / 12 / 16 / 24 / 32 / 48 px                                               |
| Radius    | `--gs-radius-sm/-md/-lg/-pill`                                      | `--radius-s/-m/-l`                                                              |
| Elevation | `--gs-shadow-sm/-md/-lg`                                            | custom 3-step scale, theme-aware (dark override on `body.theme-dark`)           |
| Type      | `--gs-font-ui`, `--gs-font-mono`                                    | `--font-interface`, `--font-monospace`                                          |
| Motion    | `--gs-dur-fast/-/-slow`, `--gs-ease`                                | 120 / 200 / 320 ms                                                              |
| Icons     | `--gs-icon-sm/-md/-lg/-xl`, `--gs-icon-stroke`                      | fixed 14/16/18/20; stroke aliases `--icon-stroke`                               |

### Rules

- **Never hardcode color.** Reach for a token; it keeps the plugin theme-adaptive.
- **One accent, sparingly.** `--gs-brand-gradient` marks the primary action and brand
  only. Everyday interactive elements use `--gs-accent` (the user's theme accent).
- **Status is semantic, not accent.** Use `--gs-success/-warning/-error/-info` for
  state; never repurpose the accent for meaning.
- **Stay on the scales.** Spacing, radius, and icon sizes come from tokens — no magic
  numbers. The `--gs-space-*` scale covers the 4px grid (4/8/12/16/24/32/48);
  sub-grid micro-spacing (Obsidian's 2px-based `--size-2-*`: 2/4/6px) has no token
  and stays on the Obsidian variable.
- **Colored surfaces need colored elevation.** A neutral `--gs-shadow-*` gets
  perceptually swamped by a strongly-coloured fill (the accent-filled user bubble
  reads flat despite carrying the shadow). Lift such an element with a `color-mix`
  accent shadow scoped to it; neutral surfaces keep the neutral `--gs-shadow-*` scale.

## Icons

Icons are **Lucide**, rendered via Obsidian's `setIcon(el, name)` (already the
convention across the codebase — keep it; no inline `<svg>`, no emoji for controls).
Obsidian's `setIcon` output already inherits the native `--icon-stroke`, so the only
thing that used to drift was **size**. Size every icon from the scale:

| Token          | px  | Use                                    |
| -------------- | --- | -------------------------------------- |
| `--gs-icon-sm` | 14  | dense / meta                           |
| `--gs-icon-md` | 16  | inline with text, chips                |
| `--gs-icon-lg` | 18  | **default** — toolbar & action buttons |
| `--gs-icon-xl` | 20  | primary / hero only                    |

**Hold one size per context.** The agent input row is all `lg` — that's why the plan
button (`list-checks`) and send button (`play`) now match at 18px instead of the old
16-vs-20 split. Keep a canonical glyph per concept: send = `play`, plan mode =
`list-checks`, copy = `copy`, delete = `trash-2`. Emoji stays for content only
(🔧 tool logs, 💬 session avatars) — it round-trips into saved session files.

Two intentional exceptions sit outside the action-icon scale: **hero icons** on
modal headers / empty states (24px) and sub-scale **micro-icons** (chevrons, tiny
status badges at 10–12px). These are display sizes, not toolbar/action icons, and
stay as literals.

## Migrating & verifying

Every surface is migrated onto the tokens, with a few intentional raw-var holdouts:
the font-size scale, Obsidian's sub-grid `--size-2-*` micro-spacing, and other
Obsidian variables with no `--gs-` equivalent still use `var(--obsidian-var)`
directly. When you touch a component's styles, keep it on the tokens.

Two rules made the migration safe, and they apply to any future work here:

- **Value-preserving first; visible changes are separate.** Migrate a surface onto
  tokens with **zero visual change** — each token aliases the same value the code
  already used — then make deliberate visual refinements in their own,
  maintainer-directed commits. Mixing the two hides bugs and makes review hard.
- **Verify by computed parity, not by eyeballing.** For a value-preserving change,
  assert the computed result is unchanged in a _live vault_: `obsidian eval` +
  `getComputedStyle`, or token-resolution equality (does `--gs-x` resolve to the same
  value as the variable it replaced?). This is exactly what caught the two real bugs
  during migration — the `--size-2-*` mis-map (2px vs 4px) and the `:root`-vs-`body`
  scope bug where color tokens silently resolved to _invalid_. A screenshot would not
  have caught either.
