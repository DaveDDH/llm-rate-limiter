# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# All-in-one check (format + lint + typecheck)
npm run check

# Individual checks
npm run format      # Prettier
npm run lint        # ESLint
npm run typecheck   # TypeScript

# Test
npm test                     # All packages
npm run test:core            # Core package
npm run test:redis           # Redis package (unit)

# E2E distributed tests (requires Redis running on localhost:6379)
npm run test:e2e                                                  # Run full test suite
npm run test:e2e:single -- --testPathPatterns=exactCapacity.test  # Run specific test, be aware of the 's' at the end, it is 'testPathPatterns' plural, NEVER 'testPathPattern' singular
npm run test:e2e:verifySetup                                      # Verify infrastructure setup works
```

## Architecture

**Monorepo** with three packages:
- `packages/core` - Core rate limiter (local/in-memory)
- `packages/redis` - Redis backend for distributed coordination
- `packages/e2e` - E2E test infrastructure (proxy, server instances, test runner)

**Layered Design**:
1. **Public API** (`LLMRateLimiter`) - Multi-model orchestration with fallback chains
2. **Internal Limiter** (`LLMRateLimiterInternal`) - Per-model rate limiting (RPM/TPM/RPD/TPD/concurrency)
3. **Backend Abstraction** - Pluggable local or Redis backends

### Key Architectural Concepts

**Pool-based allocation** (distributed mode):
- Redis calculates per-model pools using **weighted average or maximum estimates** across all job types
- Formula: `pools[model].totalSlots = floor(modelCapacity / estimatedResourcePerJob / instanceCount)`
- Redis does NOT know about job types - only model-level capacity

**Local ratio management**:
- Each instance distributes its pool slots across job types using local ratios
- Ratios are NOT shared via Redis - each instance adjusts independently based on its load
- Flexible job types can donate/receive capacity; fixed job types are protected

**Time-window-aware adjustments**:
- Refunds only happen if job completes within the same time window it started
- Job starting in minute 10, finishing in minute 11 → no refund (window 10 already closed)
- Overages are always added to counters (accurate tracking)

**Memory is LOCAL**:
- Memory constraints are per-instance, not distributed via Redis
- Final slots = `min(distributedAllocation, localMemorySlots)`

**Error handling**:
- Jobs that throw without calling `reject()` do NOT release time-windowed capacity (safe by default)
- Call `reject(usage)` to explicitly report actual usage on failure

**Core Utilities** (`packages/core/src/utils/`):
- `rateLimiterClass.ts` - Main multi-model limiter
- `rateLimiterInternalClass.ts` - Single-model limiter
- `timeWindowCounter.ts` - TPM/RPM/TPD/RPD tracking
- `jobTypeManager.ts` - Dynamic ratio allocation
- `capacityWaitQueue.ts` - Queue for jobs waiting on capacity

## Code Quality Rules

**ESLint (strict)**:
- `max-lines-per-function`: 40 lines
- `max-lines`: 300 lines per file
- `max-depth`: 2 levels of nesting

When hitting these limits, **refactor properly**:
- Extract helper functions with meaningful names
- Split large files into smaller modules
- Never compress multiple statements onto single lines

**TypeScript**: Strict mode, ES2024 target, no `any` types.

## Design Documents

Detailed designs in `docs/`:
- `distributed-slots-allocation.md` - Pool-based allocation, local ratio management
- `distributed-capacity-tracking.md` - Global usage propagation across instances
- `actual-usage-adjustment.md` - Refund/overage handling, error scenarios
- `memory-based-slots.md` - Memory as local constraint
- `max-wait-timeout.md` - Queue timeout configuration per job type/model
- `e2e-testing-guide.md` - E2E testing framework, how to run and write tests

## Documentation for e2e tests

Detailed docs for e2e tests can be found in `packages/e2e/docs/e2e-test-reference.md`

## Writing E2E Tests

### How to implement a new e2e test

1. Locate the test in `packages/e2e/docs/e2e-test-reference.md`, find its complexity level
2. Read the complexity-level doc (e.g., `complexity-low.md`) for detailed specs: configs, formulas, expected values
3. Check if needed config presets exist in `packages/e2e/serverInstance/src/rateLimiterConfigs/`
4. If a new config preset is needed, register it in **4 files**:
   - `serverInstance/src/rateLimiterConfigs/types.ts` (add to `ConfigPresetName` union)
   - `serverInstance/src/rateLimiterConfigs/registry.ts` (add import + registry entry)
   - `serverInstance/src/rateLimiterConfigs/index.ts` (add export)
   - `testRunner/src/resetInstance.ts` (add to its separate `ConfigPresetName` union)
5. Write the test file, then run `npm run check` and fix all issues

### Critical E2E infrastructure rules

- **File-level `afterAll`**: Every test file that boots instances MUST have a file-level `afterAll(() => killAllInstances())` to prevent Jest from hanging (orphaned child processes keep Jest alive)
- **Jest runs serially** (`maxWorkers: 1`) since E2E tests share infrastructure (Redis, ports)
- **`setupInstances(preset)`** kills all existing instances, cleans Redis, boots 2 instances on ports 3001/3002, and waits for allocation propagation. Each `describe` block that calls `setupInstances` in `beforeAll` recycles the infrastructure
- **`setupSingleInstance(preset)`** and **`setupThreeInstances(preset)`** are available for 1/3 instance tests (ports 3001-3003)
- **Test helpers** live in `*Helpers.ts` files alongside the test files. Constants (expected slot counts, splits) should be defined there with descriptive names to avoid magic number lint errors
- **`onAvailableSlotsChange` is required**: The server instance's rate limiter setup (`rateLimiterSetup.ts`) must include this callback. Without it, the `AvailabilityTracker` is never created, and `getAllocation()` returns `null` - causing `waitForAllocationUpdate` to always timeout
- **Split large test suites**: With `max-lines: 300`, split tests across `<name>.test.ts` and `<name>Additional.test.ts`. The pattern `--testPathPatterns=<name>.test` matches both files

### Debugging E2E test failures

- **"Allocation update timeout"**: Usually means `getAllocation()` returns `null`. Verify `onAvailableSlotsChange` is set in `rateLimiterSetup.ts`
- **"Failed to start server"**: Stale Redis state or zombie processes. Run `redis-cli FLUSHALL` and kill processes on ports 3001-3003
- **Jest hangs after tests**: Missing `afterAll(() => killAllInstances())` at file level
- **Verify infrastructure works**: `npm run test:e2e:verifySetup`

## UI Components

- When modifying the visualizer NextJS app (packages/e2e/visualizer), remember to ALWAYS use shadcn/ui components instead of creating new ones from scratch. Those components are located in `packages/e2e/visualizer/components/ui/`. To add new shadcn components run `npx shadcn@latest add <component-name>` inside that project.
- Available components: https://ui.shadcn.com/docs/components
- Note: This app uses shadcn with @base-ui/react (not @radix-ui)


## TypeScript

- Never use `any` type - always use proper explicit TypeScript types
- Never disable ESLint rules (no eslint-disable comments or config modifications)
- You MUST ALWAYS run 'npm run check' in the root folder after ANY change, then, fix all the reported issues
