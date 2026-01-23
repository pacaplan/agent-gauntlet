# Remove `name` attribute from Check Configuration

## Context
Currently, each check YAML file in `.gauntlet/checks/` includes a `name` attribute. This is redundant as the filename is already a unique identifier. This proposal aims to simplify the configuration by removing the `name` attribute and using the filename (without extension) as the check name.

## Problem
- **Redundancy**: The name is specified in both the filename and the file content.
- **Inconsistency**: It's possible for the filename and the internal `name` to diverge, causing confusion.

## Solution
- Remove `name` field from the YAML schema for checks.
- Update the configuration loader to infer the check name from the filename (e.g., `openspec-validate.yml` -> `openspec-validate`).
- Migrate all existing checks to remove the `name` field.
