# Poltergeist Testing & Sub-Agent Review Guide

## 1. Zero Untested Code Policy (Core Directive 1)

Poltergeist maintains an uncompromising, zero-untested code policy. No code may be committed or merged without comprehensive test coverage.

### 1.1 Test Tier Requirements
Every parser, mathematical transform, and encoder must have tests across three distinct tiers:

1. **Tier 1: Golden Path Tests**
   - Valid, specification-compliant files (standard PNG-24 with alpha, multi-layer PSD CS6 with masks, valid IDML spreads).
   - Verifies expected pixel dimensions, color channel values, layer geometry, and ICC profile extraction.
2. **Tier 2: Deep Edge Cases**
   - Single-pixel images (1 × 1).
   - Extreme aspect ratios (1 × 65535, 65535 × 1).
   - 16-bit and 32-bit channel precision boundaries.
   - Max TAC saturation (100% C + 100% M + 100% Y + 100% K = 400% TAC).
   - Empty layer groups, hidden layers, disabled mask channels.
   - Missing or truncated ICC profile metadata (fallback to standard profiles).
3. **Tier 3: Malicious & Adversarial Fuzzing**
   - Truncated file buffers (simulating incomplete network downloads or disk cuts).
   - Header bomb values: dimensions declared as 4 GB × 4 GB with tiny payload.
   - Corrupt CRC32 values in PNG chunks.
   - Invalid RLE scanline byte runs in PSD channels.
   - Out-of-bounds layer bounding boxes (negative coordinates, coordinates exceeding image dimensions).
   - Assert: Parsers must throw descriptive, typed errors; they must never panic, crash the runtime, or leak memory.

---

## 2. Mandatory Sub-Agent Peer Review Workflow (Core Directive 2)

Before any implementation is finalized, the primary agent must invoke a dedicated sub-agent to perform an adversarial, nitpicking peer review.

### 2.1 Peer Review Protocol
1. **Invocation**:
   - The primary agent executes `invoke_subagent` (or equivalent peer agent flow) with the explicit task of conducting a thorough code review.
2. **Scrutiny Checklist**:
   - [ ] **Memory Safety**: Are all buffers checked for bounds before access? Can any byte stride arithmetic overflow?
   - [ ] **Zero Dependencies**: Are any external npm packages or dynamic C libraries introduced? (Violates Rule 7).
   - [ ] **Test Coverage**: Does every new branch, function, and edge case have a corresponding test? Are edge cases thoroughly explored?
   - [ ] **Color Accuracy**: Are color conversions mathematically sound? Does TAC limiting preserve hue and tone?
   - [ ] **Living Documentation**: Has `docs/` been updated or created for this system?
   - [ ] **Git Hygiene**: Are internal agent views and test outputs excluded via `.gitignore`?
   - [ ] **Performance**: Is memory allocation bounded? Are there any unnecessary memory copies?
3. **Iterative Refinement**:
   - The primary agent must read the review findings.
   - Address every concern raised by the reviewer.
   - Re-verify until the sub-agent review concludes with zero issues or objections.

---

## 3. Living Documentation Protocol (Core Directive 3)

Documentation is not an afterthought; it is an active engineering deliverable:
- When modifying an existing system, update its corresponding `docs/` specification in the same commit.
- When introducing a new subsystem or file format, create a new authoritative document in `docs/`.
- Maintain exact link validity: all relative links in documentation files must resolve to existing files on disk.

---

## 4. Agent-Internal Views & Tests Separation (Core Directive 4)

To prevent polluting the public Git log:
- Operational checks (such as trailing slash linting, em-dash enforcement, temporary AST exploration, or internal agent benchmark caches) must be placed in `.agents/scratch/`, `.agents/views/`, or `.agents/tests/`.
- `.gitignore` explicitly hides these paths from Git tracking.

---

## 5. Parity & Performance References
- [Ghostscript Parity Matrix](ghostscript-parity-matrix.md): Functional and behavioral verification of Ghostscript prepress devices and CVE eliminations.
- [Performance Benchmarking](benchmarks.md): Throughput benchmarks (MP/s, MB/s), latency percentiles, and regression budgets.

