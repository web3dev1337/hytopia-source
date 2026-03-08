# Contributing to Hytopia

For code style, naming conventions, and technical standards, see [CODING_STANDARDS.md](CODING_STANDARDS.md).

---

## PR Requirements

Every pull request must include:

1. **Description** — What changed, why, and what it affects
2. **Test evidence** — How you verified it works (screenshots, test output, repro steps)
3. **Games tested** — Which games you tested against (SDK examples, your own game, etc.) and on what targets (desktop, mobile)
4. **Breaking change flag** — If defaults, public API signatures, or wire format changed, say so explicitly
5. **Performance impact** — For runtime code changes: what targets were tested, any before/after numbers

---

## Backwards Compatibility

### Defaults Are Sacred

Changing a default value is a breaking change. Existing games depend on current defaults without specifying them explicitly.

```typescript
// A game using the SDK today:
const world = new World({ name: 'My World' });
// This implicitly depends on:
//   tickRate = 60
//   gravity = { x: 0, y: -32, z: 0 }
//   ambientLightColor defaults
//   particle alpha = 1.0

// If you change gravity default to -9.8, every existing game
// that doesn't explicitly set gravity will break silently.
```

**Rules:**
- Never change a default value without a deprecation path
- If a default must change, require explicit opt-in via options
- Document the migration in the PR description
- Consider adding a console warning for one release cycle

### Public API Contract

These are part of the API contract and must not change without a major version bump:
- Method signatures on exported classes
- Event string values (`'PLAYER.JOINED_WORLD'`)
- Options interface field names and their defaults
- Wire format packet structure
- Constructor parameter shapes

---

## Performance Impact

Every change should be considered from a performance perspective. Hytopia runs on both desktop and mobile, on both client and server — what's cheap on a desktop GPU can be a bottleneck on a mobile browser, and what's fine for one player can collapse at 50.

### Think Across All Targets

| Target | Constraints to consider |
|--------|------------------------|
| Server | Tick budget (~16ms at 60Hz), memory per-world, scales with player count |
| Desktop client | GPU draw calls, texture memory, physics step time |
| Mobile client | Thermal throttling, limited GPU/RAM, battery drain, smaller bandwidth |
| High player count | Per-player serialization cost, event fan-out, network packet size |

### What to Ask Yourself

Before submitting a PR that touches runtime code:

- **Does this scale?** Will it still work with 50 players? 200 entities? What's the growth curve — linear, quadratic, constant?
- **Does this allocate?** Any `new`, string concatenation, or array creation in a per-tick or per-frame path adds GC pressure. Worse on mobile.
- **Does this add draw calls?** New visual elements, materials, or render passes affect mobile frame rate disproportionately.
- **Does this add network traffic?** Extra packets or larger payloads affect mobile users on limited connections. Check if the data can be delta-compressed or batched.
- **Does this affect startup time?** New asset loading, initialization, or validation that runs on connect/join impacts mobile users most.

### When Performance Evidence Is Required

If your change touches any of these, include before/after measurements in the PR:

- Tick loop or frame loop code
- Serialization / deserialization
- Network packet handling
- Entity creation, destruction, or sync
- Asset loading or caching
- Physics simulation setup
- Anything called per-entity or per-player per-tick

"It works on my machine" is not sufficient — consider the lowest-spec target.

---

## Review Process

### Quality Gate Stack

PRs pass through these layers in order. A failure at any layer blocks merge.

| Layer | What | Automated? |
|-------|------|:----------:|
| 1. Type checks | `tsc --noEmit` catches type errors | Yes (CI) |
| 2. Lint | ESLint enforces style rules | Yes (CI) |
| 3. Unit tests | Verify isolated behavior | Yes (CI) |
| 4. Performance tests | No regressions in hot paths | Yes (CI) |
| 5. AI review | Fresh-context automated review against CODING_STANDARDS.md | Yes |
| 6. Human review | Maintainer reviews architecture, intent, edge cases | No |
| 7. Manual testing | Run affected systems, verify behavior | No |
| 8. Game regression | Test against existing games to catch silent breakage | No |

### AI Review (Layer 5)

Automated review runs with fresh context on every PR. The reviewer:
- Checks the diff against CODING_STANDARDS.md hard rules
- Flags backwards compatibility concerns
- Identifies missing error handling or cleanup
- Catches naming convention violations

Fresh context is critical — the reviewer must not carry assumptions from previous reviews.

### Human Review (Layer 6)

Human reviewers focus on what automation cannot catch:
- Does the change make architectural sense?
- Are there edge cases the tests don't cover?
- Will this be maintainable in 6 months?
- Does the PR description accurately reflect the change?

---

## Testing Expectations

### Unit Tests

New public methods should have corresponding tests. Tests verify behavior, not implementation:

```typescript
// DO: Test behavior
it('rejects invalid packet format', () => { ... });
it('emits JOINED_WORLD when player enters', () => { ... });

// DON'T: Test implementation details
it('calls _internalMethod three times', () => { ... });
```

### Performance Tests

Changes to hot paths (tick loops, serialization, network sync) must include before/after benchmarks. Key metrics:
- Tick processing time (ms per tick)
- Serialization throughput (entities per second)
- Memory allocation rate in hot paths (should be zero)

### Game Regression

Before merging changes that affect defaults, physics, networking, or entity behavior:
1. Run at least one existing game against the branch — SDK examples, your own game, or both
2. Verify no visual or behavioral differences
3. List which games you tested in the PR (e.g. "Tested with `examples/payload-game` and my own game")
4. Note any intentional changes in the PR description

---

## Robustness Checklist

Before submitting a PR, verify:

- [ ] No new God Class additions (see CODING_STANDARDS.md section 11)
- [ ] Event listeners have matching cleanup
- [ ] Error paths use ErrorHandler, not raw throw
- [ ] No defaults were changed (or change is flagged as breaking)
- [ ] Public API types don't use `any`
- [ ] Hot path changes don't allocate (no `new` in tick loops)
- [ ] Options pattern used for configurable values
- [ ] Configuration arrays marked `readonly`
- [ ] Considered performance on mobile, not just desktop
- [ ] Changes that scale with player/entity count have been stress-tested
- [ ] No unnecessary network traffic added (batching, delta compression considered)
