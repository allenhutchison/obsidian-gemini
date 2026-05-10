# Baseline: ollama-gemma4-latest

This baseline was blessed against the **`:latest`** tag, which the
eval-harness skill flags as an anti-pattern: the tag's digest can move
under the baseline if the operator runs `ollama pull gemma4` later, and
a future "regression" report could just be a model swap.

We accepted that tradeoff for this baseline (no `gemma4:8b-q4` tag exists
locally yet). The notes below let a future operator detect drift on
inspection.

## Snapshot at bless time

| Field             | Value                                                                     |
| ----------------- | ------------------------------------------------------------------------- |
| Bless date (UTC)  | 2026-05-10T01:04:13Z                                                      |
| Plugin git SHA    | `6eb4b2a`                                                                 |
| Tag               | `gemma4:latest`                                                           |
| Manifest digest   | `c6eb396dbd59`                                                            |
| Weights blob      | `sha256-4c27e0f5b5adf02ac956c7322bd2ee7636fe3f45a8512c9aba5385242cb6e09a` |
| Architecture      | gemma4                                                                    |
| Parameters        | 8.0B                                                                      |
| Quantization      | Q4_K_M                                                                    |
| Context length    | 131072                                                                    |
| Embedding length  | 2560                                                                      |
| Required Ollama   | ≥ 0.20.0                                                                  |
| Capabilities      | completion, vision, audio, tools, thinking                                |
| Sampling defaults | `temperature=1`, `top_k=64`, `top_p=0.95`                                 |

## How to verify before trusting a comparison

```bash
ollama show gemma4:latest | grep -E "parameters|quantization"
# Expect: parameters 8.0B, quantization Q4_K_M

# Confirm the manifest digest matches the snapshot above:
curl -s http://localhost:11434/api/tags \
  | jq '.models[] | select(.name=="gemma4:latest") | .digest'
# Expect prefix: c6eb396dbd59
```

If either check disagrees with this file, the `:latest` tag has been
re-pulled. Don't trust the comparison until you re-bless or re-pin the
baseline filename to a stable tag.

## Run summary at bless time

```
Tasks:    8 × 3 runs = 24 total
pass^3:   100%   (mean 100%)
solve^3:  62.5%  (mean 79.2%)
Flaky:    2 (create-note-from-search, loop-trap-cyclic-refs)
Failing:  multi-file-summary (0/3 solved — judge matcher rejects)
Mean turns: 3.1 (p95: 7)
Cost:     $0.00 (Ollama)
```

## Next baseline

Pull a stable tag (`ollama cp gemma4:latest gemma4:8b-q4`), point the
plugin's `chatModelName` at it, and bless under `ollama-gemma4-8b-q4.json`.
That kills the anti-pattern and this NOTES file becomes redundant.
