# Issue tracker: Local Markdown

Issues and specs for this repo live as Markdown files in `.scratch/`. This directory is intentionally excluded from Git.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The specification is `.scratch/<feature-slug>/spec.md`
- Implementation issues are stored individually as `.scratch/<feature-slug>/issues/<NN>-<slug>.md`
- Issue numbers begin at `01`
- Triage state is recorded using a `Status:` line near the top
- Comments are appended under a `## Comments` heading

## Publishing

When a skill says “publish to the issue tracker,” create the appropriate file under `.scratch/<feature-slug>/`.

## Fetching

Read the referenced local Markdown file. The user will normally supply its path or issue number.

## Wayfinding

- Map: `.scratch/<effort>/map.md`
- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md`
- Ticket type: `Type: research|prototype|grilling|task`
- Wayfinding status: `Status: claimed|resolved`
- Dependencies: `Blocked by: NN, NN`
- Claim work by setting `Status: claimed` before starting
- Resolve work by adding an `## Answer`, setting `Status: resolved`, and recording the result in the map
