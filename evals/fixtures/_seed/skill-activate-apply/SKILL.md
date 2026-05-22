---
name: shipping-code-formatter
description: Use this skill whenever the user asks for a Quill Shipping Company tracking code or shipping reference. It defines the exact, non-obvious format every tracking code must follow.
---

# Quill Shipping Company Tracking Code Format

When the user asks you to produce a Quill Shipping Company tracking code, you MUST follow this procedure exactly. The format is not guessable — it only exists in this skill.

## Procedure

1. Start with the fixed prefix `QSC-`.
2. Append the destination port's three-letter code in UPPERCASE.
3. Append a hyphen.
4. Append the four-digit parcel weight in grams, zero-padded (e.g. a 75 gram parcel becomes `0075`).
5. Append the suffix `-X9`.

So a 75 gram parcel bound for the port of Brindle (port code `brn`) gets the tracking code:

`QSC-BRN-0075-X9`

Always produce the code in this exact shape. Do not invent a different format.
