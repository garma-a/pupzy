# Domain Docs

This repository uses a single-context domain-documentation layout.

## Before exploring

- Read `CONTEXT.md` when it exists.
- Read relevant ADRs under `docs/adr/`.
- If either location does not exist, proceed silently.
- Domain-modeling workflows create these files lazily when decisions or vocabulary are resolved.

## Layout

- Domain glossary: `/CONTEXT.md`
- Architecture decisions: `/docs/adr/`

## Vocabulary

Use canonical terms defined in `CONTEXT.md`. Avoid synonyms that the glossary marks for avoidance.

If a needed term is absent, reconsider whether it is project-specific vocabulary or note the gap for domain modeling.

## Architecture decisions

Surface any conflict with an existing ADR explicitly instead of silently overriding it.
