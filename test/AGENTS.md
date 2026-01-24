# Test Guidelines for CI Reliability

This document provides guidelines for writing tests that work reliably in both local development and CI environments.

## Common CI Failures and Solutions

### 1. Module Mocking Issues

**Problem**: Tests pass locally but fail in CI because `mock.module()` doesn't work reliably with dynamic imports or when modules are cached before mocking.

**Solutions**:

1. **Prefer dependency injection over module mocking**:
   ```typescript
   // ❌ Unreliable: Module mocking
   mock.module("node:child_process", () => ({
     exec: mockExec,
   }));
   
   // ✅ Reliable: Dependency injection
   // In your source file:
   export let execFn = promisify(exec);
   export function setExecFn(fn) { execFn = fn; }
   
   // In your test:
   setExecFn(mockExecFn);
   ```

2. **Patch instance methods instead of module mocking**:
   ```typescript
   // ✅ Reliable: Patch the private method directly
   const executor = new ReviewGateExecutor();
   // biome-ignore lint/suspicious/noExplicitAny: Patching private method for testing
   (executor as any).getDiff = async () => "mock diff content";
   ```

3. **When using `mock.module()`, always use full paths from the test file location**:
   ```typescript
   // ❌ Wrong: Relative to source file
   mock.module("../cli-adapters/index.js", () => ({...}));
   
   // ✅ Correct: Relative to test file in test/ directory
   mock.module("../../src/cli-adapters/index.js", () => ({...}));
   ```

### 2. Git Command Failures

**Problem**: Tests that rely on git commands fail in CI due to shallow clones, missing history, or different git configurations.

**Solutions**:

1. **Create isolated git repositories for tests**:
   ```typescript
   const TEST_DIR = path.join("/tmp", `test-${Date.now()}`);
   
   beforeEach(async () => {
     await fs.mkdir(TEST_DIR, { recursive: true });
     process.chdir(TEST_DIR);
     await execAsync("git init");
     await execAsync('git config user.email "test@test.com"');
     await execAsync('git config user.name "Test"');
     // Create initial commit
   });
   
   afterEach(async () => {
     process.chdir(originalCwd);
     await fs.rm(TEST_DIR, { recursive: true, force: true });
   });
   ```

2. **Disable CI mode in tests that need full git functionality**:
   ```typescript
   beforeEach(() => {
     originalCI = process.env.CI;
     delete process.env.CI;
     delete process.env.GITHUB_ACTIONS;
   });
   
   afterEach(() => {
     if (originalCI) process.env.CI = originalCI;
   });
   ```

3. **Mock git operations entirely when testing non-git functionality**:
   ```typescript
   // Patch getDiff to return mock content instead of running real git commands
   (executor as any).getDiff = async () => "mock diff content";
   ```

### 3. Environment Differences

**Problem**: Tests rely on environment variables or paths that differ between local and CI.

**Solutions**:

1. **Use temporary directories with absolute paths**:
   ```typescript
   const logDir = path.join("/tmp", `test-${Math.random().toString(36).slice(2)}`);
   ```

2. **Save and restore environment variables**:
   ```typescript
   let originalEnv: NodeJS.ProcessEnv;
   
   beforeEach(() => {
     originalEnv = { ...process.env };
   });
   
   afterEach(() => {
     process.env = originalEnv;
   });
   ```

### 4. Async Timing Issues

**Problem**: Tests are flaky because they depend on timing that varies between environments.

**Solutions**:

1. **Use proper async/await patterns**:
   ```typescript
   // ❌ Flaky: Race condition
   executor.start();
   expect(executor.isRunning).toBe(true);
   
   // ✅ Reliable: Wait for operation
   await executor.start();
   expect(executor.isRunning).toBe(true);
   ```

2. **Avoid arbitrary timeouts**:
   ```typescript
   // ❌ Flaky: Hardcoded timeout
   await new Promise(r => setTimeout(r, 100));
   
   // ✅ Reliable: Wait for specific condition
   await waitFor(() => executor.isComplete);
   ```

## Test File Organization

- All test files are in `/test` directory, mirroring the `/src` structure
- Import paths use `../../src/` to reach source files
- Each test file should clean up any resources (temp files, directories) in `afterEach`

## Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test test/gates/review.test.ts

# Run with verbose output
bun test --verbose
```

## Adding New Tests

1. Create test file in appropriate subdirectory under `/test`
2. Use imports relative to the test file location: `../../src/...`
3. Follow the patterns above for mocking
4. Ensure tests clean up after themselves
5. Run tests locally AND verify they pass in CI before merging
