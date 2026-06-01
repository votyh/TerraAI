---
name: slice-tasks
description: 'Breaks TerraAI feature requirements into an ordered series of thin, vertical end-to-end slices. Use after a PRD or design session when planning implementation. Each task must cut through the full integration stack from a specific database query or API fetch in the Python backend up to a UI state change in the Next.js or Vite frontend. No generic tasks allowed — every slice must result in a working proof of concept. Trigger phrases: slice tasks, task breakdown, tracer bullet, vertical slice, implementation plan, break this down, sprint planning, what do I build first.'
argument-hint: 'Paste the PRD or describe the feature to be sliced (e.g. "net buildable envelope calculator")'
---

# /slice-tasks — Tracer Bullet Engine

## Purpose
Produce an ordered list of independent, thin vertical slices — each one a self-contained proof of concept that works end-to-end. No slice is a setup task, a generic "write the UI", or a prerequisite that delivers no user-visible or test-visible value on its own.

## When to Use
- After `/to-envelope-prd` has locked down requirements
- At the start of a sprint or implementation session
- When a feature feels too large to know where to start
- When a previous implementation attempt stalled due to scope creep

## Procedure

### Step 1 — Read Context

Read the PRD from the conversation or the relevant engine files to understand:
- What data flows from where to where
- The full stack layers involved: LINZ/AKL API → Python backend → FastAPI route → TypeScript frontend → React component → UI state
- Which parts already exist vs. what is net-new

Reference files for TerraAI's current stack:
- [engine/linz-connector.ts](../../../../engine/linz-connector.ts) — LINZ WFS integration
- [engine/infrastructure-ghost.ts](../../../../engine/infrastructure-ghost.ts) — AKL GIS, pipe detection, zone coverage
- [engine/valuation-engine.ts](../../../../engine/valuation-engine.ts) — RLV formula
- [backend/main.py](../../../../backend/main.py) — FastAPI entry point
- [auditor.ts](../../../../auditor.ts) — Current simplified audit surface

### Step 2 — Identify the Tracer Bullet

Find the single thinnest path through the entire stack that proves the feature works. This is Slice 1. It should:
- Use hard-coded or mock data where real data isn't wired yet
- Return a real, visible result (a number, a verdict, a rendered component)
- Take no more than a few hours to implement

### Step 3 — Generate the Slice List

For each slice, output this block:

```
Slice N — <name>
-----------
Starts at:  <exact function, API endpoint, or DB query>
Ends at:    <exact UI component, state variable, or API response>
Inputs:     <what this slice consumes — real or mocked>
Output:     <what a developer can see or assert when this slice is done>
Depends on: <Slice numbers that must be complete first, or "none">
Test signal: <the one thing that proves this slice works — console log, rendered value, passing test>
Scope guard: <what is explicitly NOT included in this slice>
```

### Step 4 — Apply the Slice Rules

Review every generated slice against these rules. Reject any that violate them.

**Rule 1 — No orphan tasks.** Every slice must produce something observable. "Refactor the types" or "set up the database schema" alone are not slices — they must be bundled with a slice that returns data through them.

**Rule 2 — No multi-layer generics.** A slice cannot say "build the frontend". It must name the specific component and the specific state change (e.g. "render `ValuationResult.rlv_nzd` from the `/api/valuation` response").

**Rule 3 — Smallest meaningful cut.** If a slice can be split into two independent slices that are both observable, split it.

**Rule 4 — Mock data is allowed, coupling is not.** Mocking a LINZ API response in Slice 1 is fine. Hardcoding a parcel ID that only exists in one environment is not.

**Rule 5 — Slice ordering = dependency ordering.** If Slice 3 depends on Slice 2, they must be ordered that way. Flag circular dependencies immediately.

### Step 5 — Deliver

Output:
1. The ordered slice list
2. A recommended "start here" slice highlighted
3. Any blockers that must be resolved before Slice 1 can begin (missing API keys, unresolved PRD items, unbuilt infrastructure)

## Example Slice Shape (TerraAI reference)

```
Slice 1 — Hard-coded LINZ Parcel → RLV Number on Screen
-----------
Starts at:  fetchParcelByCoordinate() called with a fixed Auckland test coordinate
Ends at:    ValuationResult component renders residual_land_value_nzd
Inputs:     Hard-coded coordinate { lng: 174.7633, lat: -36.8485 }; hard-coded AUPZoneCode "MHU"
Output:     Browser shows an NZD figure for RLV
Depends on: none
Test signal: console.log(result.residual_land_value_nzd) prints a non-zero number
Scope guard: No real GDV estimate, no comparables, no slope penalty wired — use defaults
```

## Anti-patterns to Reject

| Task as written | Why it fails | Fix |
|---|---|---|
| "Set up PostGIS" | No observable output | Bundle with "return parcel area from DB endpoint" |
| "Write the frontend" | Not a slice | "Render `score` field from `/api/audit` in `ValuationResult`" |
| "Integrate LINZ API" | Too broad | Split into: fetch parcel → map to ParcelResult → return via endpoint |
| "Handle all edge cases" | Not a slice | Each edge case is a dedicated slice with a specific test signal |
