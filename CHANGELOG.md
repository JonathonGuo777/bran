# Changelog

All notable changes to Bran will be documented in this file.

## 0.2.0 - 2026-07-18

- Added the zero-dependency `bran compile`, `bran audit`, and `bran settle` CLI.
- Added schemas for `SourceEvent`, `BranInputBundle`, `NarrativePackage`, `ProductionRequest`, and the runtime contract.
- Replaced story-specific settlement and scene checks with a package-driven auditor.
- Added machine-readable derived-state expressions and generic prioritized settlement evaluation.
- Added compiler and audit receipts with deterministic artifact hashes and tamper detection.
- Added hash-bound staged author reviews and automatic `compiled` to `reviewed` lifecycle promotion.
- Added stable-ID package diffs and immutable lineage guidance for revision, fork, and rollback flows.
- Added an original three-scene, two-recipe fixture and automated core regression tests.
- Defined the boundary between Bran narrative compilation, downstream material production, UYI runtime state, and relationship-memory candidates.
- Legacy packages whose derived fields contain prose `formula` values only must add machine-readable `expression` values before the generic auditor can recompute settlement.

## 0.1.0 - 2026-07-16

- Published the initial Bran Agent Skill and Codex plugin wrapper.
- Added artifact and quality-gate contracts for executable branching-story packages.
- Added an independent Node.js auditor for state paths, replay mechanics, evidence decisions, Agent information gain, settlement consistency, trace coverage, dominance, carryover classes, and quality-receipt freshness.
- Added a repository marketplace for Codex installation.
