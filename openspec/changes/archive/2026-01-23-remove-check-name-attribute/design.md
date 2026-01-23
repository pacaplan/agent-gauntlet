# Design Decisions

## Naming Strategy
- The check name will be derived strictly from the filename.
- Extension `.yml` or `.yaml` will be stripped.
- The loader will assign this derived name to the loaded config object if internal components still require a `name` property on the object itself.

## Backward Compatibility
- This is a breaking change for configuration files.
- All existing configuration files must be updated.

## Schema Changes
- `checkGateSchema`: Remove `name`.
- `LoadedCheckGateConfig`: May still include `name` property if useful for runtime, but it will be populated by the loader, not Zod validation of the file content.

## Loader Logic
- Iterate through files in `.gauntlet/checks/`.
- For each file:
    - Parse YAML.
    - Validate against new `checkGateSchema` (which lacks `name`).
    - Inject `name` (from filename) into the resulting object if needed for the `LoadedConfig` map or explicit back-references.
