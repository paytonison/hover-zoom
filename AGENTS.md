# Repository Guidelines

## Project Overview
This repository contains a Safari userscript that “hover zooms” image thumbnails on supported websites.

## Project Structure & Module Organization
At the moment, the repo is intentionally minimal:
- `README.md`: project description.

Suggested structure as the codebase grows:
- `src/hover-zoom.user.js`: the main userscript (including the `// ==UserScript==` metadata block).
- `src/sites/`: per-site logic keyed by hostname (for example: `src/sites/reddit.com.js`).
- `assets/`: screenshots and other static files used in docs.
- `tests/`: automated tests (only if/when added).

## Build, Test, and Development Commands
No build, lint, or test tooling is configured in this repository yet.
- Development: load the userscript in Safari using your preferred userscript manager and test changes on real pages.
- If you add tooling (for example, npm scripts), document the exact commands here (e.g., `npm test`, `npm run lint`) and keep them working for new contributors.

## Coding Style & Naming Conventions
- JavaScript: prefer modern syntax (`const`/`let`), avoid implicit globals, and keep functions small.
- Formatting: 2-space indentation; aim to keep lines under ~100 characters.
- Organization: keep site-specific selectors and behaviors close together; name site modules by hostname (`example.com.js`).

## Testing Guidelines
- Manual testing is required: verify hover-zoom behavior in Safari and confirm normal click/scroll behavior isn’t disrupted.
- If automated tests are introduced, keep them runnable with a single command and name files clearly (e.g., `tests/*.test.js`).

## Commit & Pull Request Guidelines
This directory does not currently include Git history, so there are no established commit conventions to follow.
- Use clear, scoped messages (e.g., `feat: add <site> support`, `fix: avoid zoom on SVG`).
- PRs should include: what/why, sites (or URLs) tested, and screenshots/GIFs when UI behavior changes.

## Security & Configuration Tips
- Keep URL match patterns as narrow as practical.
- Never fetch/execute remote code; treat page content as untrusted input.
- Avoid collecting or logging browsing data.

## Agent-Specific Instructions
- Keep changes focused; avoid adding dependencies without explaining the tradeoffs.
- If requirements are ambiguous, ask before reorganizing files or introducing new tooling.
