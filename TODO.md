# TODO

- Refactor scheduler/merge flow for testability.
  - Rationale: The cleanup test drives the full scheduler path, which performs ~11 sequential mocked Octokit requests (installations, repos, searches, label add, PR fetch, checks, merge, label removals). Even though they are mocked, they still traverse Probot/Octokit auth hooks and request/response handling in series, which adds ~0.4–0.5s per request and pushes the test to ~5s. There is also an auth layer in `@octokit/auth-app` that can introduce up to ~5s of retry backoff on fresh installation tokens if any request returns 401.
  - Goal: Expose the core merge/cleanup logic behind a unit-testable function and inject an Octokit stub (or mock `app.auth`) to avoid the full HTTP pipeline in tests.
