---
description: create a commit message
agent: build
model: opencode-go/deepseek-v4-flash
---

# git commit

Generate a Conventional Commit message for the staged diff.

## Steps

1. Read `git diff --staged`.
2. Write a commit message in this form:

   ```text
   <type>[optional scope]: <description>

   [optional body]

   [optional footer]
   ```

   - Type: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
   - Scope: optional; use for the affected component (e.g. `api`, `auth`, `parser`).
   - Subject: under 50 characters, imperative mood, lowercase, no trailing period.
   - Body: wrap at 72 characters; explain why/what, not how.
   - Footer: use for `BREAKING CHANGE:` or issue references (`Closes: #123`).

3. Output only the commit message, with no commentary or markdown code fence.

## Completion

Done when a single Conventional Commit message matching the staged diff is produced.
