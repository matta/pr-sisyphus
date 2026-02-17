# Probot Design: Best Practices & Configuration

## Bulk Actions & Permissions
- **Always Verify Intent**: Actions triggered by direct user interaction (e.g., replying to a comment) are implicitly authorized. However, **bulk operations** (scanning all open issues, mass-labeling) must require explicit opt-in.
- **Example**: The `stale` app only processes repositories that contain a `.github/stale.yml` configuration file. Similarly, Patch Pilot should only activate its merge queue logic if a configuration file (e.g., `.github/patch-pilot.yml`) is present.

## Dry Run Capabilities
- **Safety First**: Any destructive action or automated workflow should support a "dry run" mode.
- **Implementation**: Instead of executing API calls (closing issues, merging PRs), the app should log the intended actions.
- **Default Behavior**: If no configuration is present or if explicitly configured, the app should default to dry-run mode to prevent accidental changes.

## Configuration Strategy

### 1. Minimal & Sensible Defaults
- Users should not need to configure every single option.
- Provide sensible defaults for timeouts, labels, and behavior so the app works "out of the box" once enabled.

### 2. Full Customization
- Every behavioral aspect (labels used, merge method, timeouts) should be overridable via configuration.

### 3. Storage Location
- Configuration must be stored in the target repository, typically in the `.github/` directory.
- Allow for organization-wide defaults using the `.github` repository.

### 4. Shared Configurations (`_extends`)
- Support inheriting configuration from other repositories or organizations to reduce duplication.
- **Mechanism**: Use the `_extends` key in the YAML config.

**Examples:**
- Extend from a repo in the same org:
  ```yaml
  _extends: github-settings
  name: myrepo
  ```
- Extend from another org/repo:
  ```yaml
  _extends: other-org/shared-config
  timeout: 30
  ```
- Extend from a specific file path:
  ```yaml
  _extends: my-org/settings:.github/patch-pilot-base.yml
  ```

## Implementation Plan for Patch Pilot
To align with these principles, Patch Pilot will:
1.  Check for `.github/patch-pilot.yml` before processing any repository.
2.  If the file is missing, the scheduler will skip the repository or log a "dry run" message.
3.  Implement a `dryRun: true/false` flag in the config.
4.  Utilize `context.config` to load and merge settings, supporting `_extends`.
