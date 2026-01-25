# Stop Hook Manual Test Plan

This document provides step-by-step procedures for manually testing the stop hook functionality.

## Prerequisites

- Agent Gauntlet installed globally
- A test project with `.gauntlet/config.yml`
- Claude Code configured with the stop hook

## Test Scenarios

### Scenario 1: Stop reason includes console log path

**Purpose**: Verify the stop reason includes the path to the console log file.

**Setup**:
1. Ensure a gauntlet project exists with at least one failing check
2. Ensure `gauntlet_logs/` directory exists with at least one `console.N.log` file

**Steps**:
1. Run `echo '{}' | agent-gauntlet stop-hook`
2. Capture the JSON output

**Expected Result**:
- Output includes `"continue": false`
- `stopReason` contains `**Console log:**` followed by the path
- Path points to the highest-numbered `console.N.log` file

**Verification**:
```bash
echo '{}' | agent-gauntlet stop-hook 2>/dev/null | jq -r '.stopReason' | grep -q "Console log:" && echo "PASS" || echo "FAIL"
```

---

### Scenario 2: Stop reason excludes manual re-run instruction

**Purpose**: Verify the stop reason does NOT tell the agent to run `agent-gauntlet run` manually.

**Setup**:
1. Gauntlet project with a failing check

**Steps**:
1. Run `echo '{}' | agent-gauntlet stop-hook`
2. Examine the `stopReason` text

**Expected Result**:
- `stopReason` does NOT contain "Run `agent-gauntlet run` to verify"
- `stopReason` DOES mention the hook auto-re-runs

**Verification**:
```bash
reason=$(echo '{}' | agent-gauntlet stop-hook 2>/dev/null | jq -r '.stopReason')
if echo "$reason" | grep -q "Run \`agent-gauntlet run\` to verify"; then
  echo "FAIL: Contains manual re-run instruction"
else
  echo "PASS: No manual re-run instruction"
fi
```

---

### Scenario 3: Stop reason includes urgent fix directive

**Purpose**: Verify the stop reason uses emphatic language about fixing issues immediately.

**Setup**:
1. Gauntlet project with a failing check

**Steps**:
1. Run `echo '{}' | agent-gauntlet stop-hook`
2. Examine the `stopReason` text

**Expected Result**:
- Contains "GAUNTLET FAILED" in bold/uppercase
- Contains "YOU MUST FIX ISSUES NOW"
- Contains text about not being able to stop
- Mentions the hook will auto-re-run

**Verification**:
```bash
reason=$(echo '{}' | agent-gauntlet stop-hook 2>/dev/null | jq -r '.stopReason')
checks_passed=0
echo "$reason" | grep -q "GAUNTLET FAILED" && ((checks_passed++))
echo "$reason" | grep -q "MUST FIX ISSUES NOW" && ((checks_passed++))
echo "$reason" | grep -q "cannot stop" && ((checks_passed++))
echo "$reason" | grep -q "automatically re-run" && ((checks_passed++))
[ $checks_passed -eq 4 ] && echo "PASS" || echo "FAIL: Only $checks_passed/4 checks passed"
```

---

### Scenario 4: Stop reason includes trust level

**Purpose**: Verify the stop reason includes trust level guidance.

**Setup**:
1. Gauntlet project with a failing check

**Steps**:
1. Run `echo '{}' | agent-gauntlet stop-hook`
2. Examine the `stopReason` text

**Expected Result**:
- Contains "Review trust level: medium"
- Explains when to fix vs skip issues

**Verification**:
```bash
reason=$(echo '{}' | agent-gauntlet stop-hook 2>/dev/null | jq -r '.stopReason')
echo "$reason" | grep -q "Review trust level: medium" && echo "PASS" || echo "FAIL"
```

---

### Scenario 5: Stop reason includes violation handling

**Purpose**: Verify the stop reason explains how to handle violations.

**Setup**:
1. Gauntlet project with a failing check

**Steps**:
1. Run `echo '{}' | agent-gauntlet stop-hook`
2. Examine the `stopReason` text

**Expected Result**:
- Contains instructions about `"status"` and `"result"` fields
- Mentions `"fixed"` and `"skipped"` values

**Verification**:
```bash
reason=$(echo '{}' | agent-gauntlet stop-hook 2>/dev/null | jq -r '.stopReason')
checks_passed=0
echo "$reason" | grep -q '"status": "fixed"' && ((checks_passed++))
echo "$reason" | grep -q '"status": "skipped"' && ((checks_passed++))
echo "$reason" | grep -q '"result"' && ((checks_passed++))
[ $checks_passed -eq 3 ] && echo "PASS" || echo "FAIL: Only $checks_passed/3 checks passed"
```

---

### Scenario 6: Stop reason includes termination conditions

**Purpose**: Verify the stop reason lists all termination conditions.

**Setup**:
1. Gauntlet project with a failing check

**Steps**:
1. Run `echo '{}' | agent-gauntlet stop-hook`
2. Examine the `stopReason` text

**Expected Result**:
- Lists "Status: Passed"
- Lists "Status: Passed with warnings"
- Lists "Status: Retry limit exceeded"

**Verification**:
```bash
reason=$(echo '{}' | agent-gauntlet stop-hook 2>/dev/null | jq -r '.stopReason')
checks_passed=0
echo "$reason" | grep -q "Status: Passed" && ((checks_passed++))
echo "$reason" | grep -q "Status: Passed with warnings" && ((checks_passed++))
echo "$reason" | grep -q "Status: Retry limit exceeded" && ((checks_passed++))
[ $checks_passed -eq 3 ] && echo "PASS" || echo "FAIL: Only $checks_passed/3 conditions found"
```

---

## Full Test Script

Run all scenarios as a single script:

```bash
#!/bin/bash
set -e

echo "=== Stop Hook UAT Test Suite ==="
echo ""

# Ensure we're in a gauntlet project
if [ ! -f ".gauntlet/config.yml" ]; then
  echo "ERROR: Not in a gauntlet project. Run from a directory with .gauntlet/config.yml"
  exit 1
fi

# Get stop reason (assumes gauntlet will fail)
reason=$(echo '{}' | agent-gauntlet stop-hook 2>/dev/null | jq -r '.stopReason')

if [ -z "$reason" ] || [ "$reason" = "null" ]; then
  echo "SKIP: Gauntlet passed or no blocking response"
  exit 0
fi

echo "Testing stop reason content..."
echo ""

# Test 1: Console log path
if echo "$reason" | grep -q "Console log:"; then
  echo "[PASS] Scenario 1: Console log path included"
else
  echo "[FAIL] Scenario 1: Console log path missing"
fi

# Test 2: No manual re-run instruction
if ! echo "$reason" | grep -q 'Run `agent-gauntlet run` to verify'; then
  echo "[PASS] Scenario 2: No manual re-run instruction"
else
  echo "[FAIL] Scenario 2: Contains manual re-run instruction"
fi

# Test 3: Urgent fix directive
if echo "$reason" | grep -q "GAUNTLET FAILED" && \
   echo "$reason" | grep -q "MUST FIX ISSUES NOW" && \
   echo "$reason" | grep -q "cannot stop"; then
  echo "[PASS] Scenario 3: Urgent fix directive present"
else
  echo "[FAIL] Scenario 3: Missing urgent fix directive"
fi

# Test 4: Trust level
if echo "$reason" | grep -q "Review trust level: medium"; then
  echo "[PASS] Scenario 4: Trust level guidance present"
else
  echo "[FAIL] Scenario 4: Trust level guidance missing"
fi

# Test 5: Violation handling
if echo "$reason" | grep -q '"status": "fixed"' && \
   echo "$reason" | grep -q '"status": "skipped"'; then
  echo "[PASS] Scenario 5: Violation handling instructions present"
else
  echo "[FAIL] Scenario 5: Violation handling instructions missing"
fi

# Test 6: Termination conditions
if echo "$reason" | grep -q "Status: Passed" && \
   echo "$reason" | grep -q "Status: Passed with warnings" && \
   echo "$reason" | grep -q "Status: Retry limit exceeded"; then
  echo "[PASS] Scenario 6: All termination conditions listed"
else
  echo "[FAIL] Scenario 6: Missing termination conditions"
fi

echo ""
echo "=== Test Suite Complete ==="
```

Save this as `test-stop-hook.sh` and run with `bash test-stop-hook.sh` from a gauntlet project directory.
