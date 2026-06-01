---
name: to-envelope-prd
description: 'Translates TerraAI conversation history and codebase into a strict, immutable Product Requirements Document for the valuation and net buildable envelope engine. Use after a design discussion or /grill-me session to lock down requirements before implementation. Covers: LINZ API endpoints, data layers, frontend inputs, mathematical formulas for net buildable footprint, GIS library steps (turf.js, Shapely), edge cases for irregular parcel shapes. Trigger phrases: write a PRD, requirements document, envelope PRD, legal to code, to-envelope-prd, net buildable PRD, lock down requirements.'
argument-hint: 'Describe the feature being specified (e.g. "HIRB calculator and net buildable envelope for MHU")'
---

# /to-envelope-prd — Legal-to-Code Blueprint

## Purpose
Produce a strict, immutable PRD that developers and AI can implement against without returning to ambiguous natural-language discussion. Every formula, API call, and edge case must be stated precisely enough that a new developer with no prior context could implement it correctly.

## When to Use
- After a `/grill-me` session has resolved all spatial/zoning assumptions
- Before writing any new engine file, formula, or GIS integration
- When converting district plan text (AUP chapters) into code requirements
- When specifying a new LINZ or Auckland Council API integration

## Procedure

### Step 1 — Read the Codebase Baseline

Before drafting anything, read these files to establish what already exists:

| File | Why |
|------|-----|
| [engine/linz-connector.ts](../../../../engine/linz-connector.ts) | Existing LINZ WFS integration, layer IDs, CRS, `ParcelResult` shape |
| [engine/infrastructure-ghost.ts](../../../../engine/infrastructure-ghost.ts) | Pipe/flow-path fetchers, `AUP_ZONE_PROFILES`, `resolveZoneCoverageDeduction`, `calculateLandAreaDeductions` |
| [engine/valuation-engine.ts](../../../../engine/valuation-engine.ts) | RLV formula, `calculateTopographicalPenalty`, `resolveSuburbBaseRate`, how zone feeds into valuation |
| [auditor.ts](../../../../auditor.ts) | Current simplified audit surface — note gaps vs. the typed engine layer |

### Step 2 — Extract Requirements from Conversation

Scan the conversation for:
- Feature description and user intent
- Any `/grill-me` branch resolutions already agreed
- Constraints mentioned (AUP chapters, LINZ layers, cost thresholds)
- Any explicit rejections ("we're not doing X yet")

### Step 3 — Draft the PRD

The output document **must** contain exactly these four sections. Do not omit or rename them.

---

#### Section 1 — Data Sources & API Endpoints

For every external data source required:

```
Source:        <LINZ / Auckland Council ArcGIS / other>
Layer / URL:   <exact endpoint, layer ID, or WFS typeNames>
Auth:          <API key env var name>
CRS in:        <EPSG code of data as returned>
CRS out:       <EPSG code expected by this engine>
Fields used:   <exact property names consumed>
Fallback:      <what to return if the source is unavailable>
```

Flag any layer not yet integrated in `linz-connector.ts` or `infrastructure-ghost.ts` as **NEW INTEGRATION REQUIRED**.

#### Section 2 — Frontend Input Contract

For every parameter the backend engine must receive from the frontend:

```
Parameter:     <name>
Type:          <TypeScript type or JSON schema>
Source:        <how the user provides it: map click / form field / auto-resolved>
Validation:    <range, format, or constraint checks at the API boundary>
CRS:           <EPSG code if spatial>
```

#### Section 3 — Mathematical & Geometric Formulas

For every calculation the engine performs:

```
Step N:        <human-readable name>
Inputs:        <variable names and types>
Formula:       <explicit formula or algorithm reference>
Library:       <turf.js function / Shapely method / custom, with version>
CRS required:  <EPSG code the calculation must run in>
Output:        <variable name, type, and units>
Precision:     <rounding rule, e.g. "round to nearest m²">
```

State explicitly whether any step requires projection from EPSG:4326 to EPSG:2193 for metric accuracy, and which component owns the transformation.

#### Section 4 — Edge Cases & Error Contracts

For every known edge case:

```
Case:          <description>
Trigger:       <condition that causes it>
Expected behaviour: <exact return value or error code>
Engine impact: <which calculation is affected>
```

Mandatory cases to define if not already resolved by `/grill-me`:
- MultiPolygon parcel returned by LINZ
- Parcel coordinate falls outside NZ bounds
- Parcel straddles two AUP zones
- `calc_area_m2` is null
- Pipe network API unavailable
- Site slope exceeds 45°
- Zone not in `AUP_ZONE_PROFILES`

---

### Step 4 — Validate Completeness

Before delivering the PRD, verify:

- [ ] Every formula references a specific library function or mathematical definition — no "calculate the area somehow"
- [ ] Every API field name is exact (match against known LINZ/AKL response schemas)
- [ ] Every edge case has an explicit `Expected behaviour` — no "handle gracefully"
- [ ] CRS is stated at every data-in and data-out boundary
- [ ] No section says "TBD" — if something is genuinely unknown, call it out as a **BLOCKER** requiring resolution before implementation

### Step 5 — Deliver

Output the PRD as a fenced code block or a file the developer can paste directly. Label it clearly:

```
TerraAI PRD — <Feature Name>
Status: DRAFT | APPROVED
Author: <session date>
Resolves: <linked /grill-me session or GitHub issue if known>
```

## Quality Bar

A PRD produced by this skill is considered complete when a developer who has never read the conversation could implement the feature correctly using only:
1. The PRD
2. The four codebase files listed in Step 1
3. The referenced library documentation
