---
name: grill-me
description: 'Relentlessly interrogates spatial logic and data assumptions before any backend code is written. Use when designing or extending any TerraAI feature that touches geometry, coordinate systems, GIS data, or Auckland Unitary Plan zoning rules. Covers: coordinate reference systems (NZGD2000/EPSG:2193 vs WGS-84/EPSG:4326 vs Web Mercator/EPSG:3857), multi-polygon parcel handling, AUP zoning constraints (height-in-relation-to-boundary, HIRB, site coverage, Mixed Housing Urban, MHU, MHS, THAB), LINZ WFS, Auckland Council GIS. Trigger phrases: grill me, spatial logic, CRS, geometry, parcel, zoning, height in relation, HIRB, AUP, multi-polygon, auditor, runAudit, net buildable envelope.'
argument-hint: 'Describe the feature or engine you are designing (e.g. "HIRB calculator for MHU zone")'
---

# /grill-me — Spatial Logic Gatekeeper

## Purpose
Conduct a structured, relentless design interview before writing any spatial feature code. Forces the designer to resolve every branch of the geometry and zoning decision tree before implementation begins.

## When to Use
- Designing or extending any engine that reads LINZ parcel geometry
- Adding AUP zoning rules (coverage, height, setbacks, HIRB)
- Changing how coordinates are projected, stored, or compared
- Adding multi-polygon parcel support
- Any feature that intersects Auckland Council GIS data (pipes, flow paths, zones)
- Bridging `auditor.ts` (simplified) with the typed engine layer

## Codebase Baseline

Before asking any question, read these files to avoid asking what the code already answers:

| File | What it establishes |
|------|---------------------|
| [engine/linz-connector.ts](../../../../engine/linz-connector.ts) | CRS in use (EPSG:4326), BBOX query pattern, `LINZGeometry` type (`Polygon \| MultiPolygon`), `srsName: "EPSG:4326"` hard-coded |
| [engine/infrastructure-ghost.ts](../../../../engine/infrastructure-ghost.ts) | `Point2D [lng, lat]`, `Ring`, `SimplePolygon` (single exterior + holes), ray-casting in degree-space, AUP zone codes (`MHU`/`MHS`/`THAB`), coverage limits (45/40/50%), pipe intersection math, AKL GIS queries use `wkid: 4326` |
| [engine/valuation-engine.ts](../../../../engine/valuation-engine.ts) | How `AUPZoneCode` and `resolveZoneCoverageDeduction` feed into RLV; `AUPZoneCode` is an optional input |
| [auditor.ts](../../../../auditor.ts) | Simplified audit surface — `zoneType: 'Mixed Housing Urban' \| 'Single House' \| 'Other'` is a raw string, **not** connected to `AUPZoneCode`; `pipeCapacity` is `'high' \| 'low' \| 'none'`, not a `CapacityFault[]` |

---

## Interview Procedure

Work through every branch in order. Do not skip a branch because the answer "seems obvious". Mark each branch **RESOLVED** once an unambiguous decision is recorded in writing.

---

### Branch 1 — Coordinate Reference System

**Already established by the code:**
- LINZ WFS queries use `srsName: "EPSG:4326"` and return `[lng, lat]` degree pairs.
- AKL Council ArcGIS queries use `inSR: "4326"` / `outSR: "4326"`.
- All `Point2D` values across the codebase are `[lng, lat]` in WGS-84.
- The NZ national grid is **NZGD2000 / EPSG:2193** — LINZ survey data is natively in this CRS but the WFS endpoint reprojects on the fly.

**Open questions — must be resolved:**

1. **EPSG:2193 entry points** — If a coordinate arrives from an address geocoder (e.g. LINZ address API, koordinates.com) or a survey instrument, does it arrive in EPSG:2193 or EPSG:4326? Is a projection step required at the API boundary before `fetchParcelByCoordinate` is called? Who owns that conversion?

2. **Web Mercator / map-click path** — Frontend map tiles are almost certainly served in EPSG:3857 (Web Mercator). When the user clicks a point on the map, does the frontend convert to EPSG:4326 before posting to the API, or does the backend accept EPSG:3857 and convert? Which component owns the `proj4` / `@turf/projection` call?

3. **Metric area calculations** — `calc_area_m2` from LINZ is trusted as-is. However, the ray-casting in `infrastructure-ghost.ts` (`pointInRing`, `pointInPolygon`) operates in degree-space, which is **not** area-accurate at NZ latitudes (~37% E-W distortion at -37°). If the system ever computes area from ring coordinates (parcel split, setback shrink, HIRB envelope), will it project to EPSG:2193 for the calculation, or use a Haversine/spherical-shoelace approach?

4. **Canonical storage CRS** — If parcel geometries are ever persisted to the database, which CRS is the canonical storage format? PostGIS defaults to EPSG:4326; NZ surveys are EPSG:2193. Declare one and enforce it at the persistence boundary.

---

### Branch 2 — Multi-Polygon Geometry

**Already established by the code:**
- `LINZGeometry.type` is `"Polygon" | "MultiPolygon"` with coordinates typed as `number[][][] | number[][][][]`.
- `ParcelGeometry` in `infrastructure-ghost.ts` uses `SimplePolygon` (single exterior + holes array).
- **There is no existing adapter** that converts a `LINZGeometry` MultiPolygon into the `SimplePolygon` interface. The gap is real and currently unhandled.

**Open questions — must be resolved:**

1. **When does LINZ return MultiPolygon?** Known real-world cases: stratum/unit titles with separate balcony allotments, parcels split by a closed road reserve, non-contiguous legal lots under one title. Is the system required to handle these, or is a `PARSE_ERROR` return acceptable for now?

2. **"The developable site" selection** — If a MultiPolygon is returned, which component polygon is treated as the site? Options: (a) largest by `calc_area`; (b) the part containing the queried coordinate; (c) the union of all parts. The answer affects every downstream calculation.

3. **Pipe intersection across the gap** — `pipeIntersectsPolygon` checks individual `SimplePolygon` instances. If a pipe crosses the gap *between* two parts of a MultiPolygon, is that classified as an intersection (triggering a cost flag) or not? Decide before writing the adapter.

4. **Buildable area per part** — `buildable_area?: SimplePolygon` in `ParcelGeometry` is a single optional polygon. For a MultiPolygon parcel, who computes buildable area per part and how are the results aggregated into a single `LandAreaDeduction`?

5. **Area over-counting** — `calc_area_m2` from LINZ is the legal sum of all parts. If only one part is developable, the valuation engine and `runAudit` are over-counting net buildable area. What is the intended behaviour — use `calc_area_m2` as-is, or recompute from the selected part's ring?

---

### Branch 3 — Auckland Unitary Plan Zoning Constraints

**Already established by the code:**
- `AUP_ZONE_PROFILES`: MHU = 45% coverage, MHS = 40%, THAB = 50%.
- `resolveZoneCoverageDeduction` applies the coverage cap to gross area.
- `auditor.ts` uses the raw string `'Mixed Housing Urban'` — it is **not** typed as `AUPZoneCode` and is not connected to `resolveZoneCoverageDeduction`.
- No HIRB, height limit, setback, or density logic exists anywhere in the codebase yet.

**Open questions — must be resolved:**

1. **Height-in-Relation-to-Boundary (HIRB) scope** — AUP H4.6.3 (MHU) and H3.6.3 (MHS) prescribe recession plane rules: a building face must not penetrate a plane projected inward from each boundary at a specified angle and height. Is HIRB to be modelled in this system? If yes:
   - What inputs are required: boundary line segments, proposed building footprint polygon, proposed ridge/eave height?
   - Output shape: binary pass/fail, maximum permitted height at each setback distance, or a full 3-D recession-plane envelope?
   - Which boundary types trigger HIRB — all legal boundaries, or only boundaries adjoining a lower-density or residential zone?

2. **Absolute height limits** — MHU: 11 m (3 storeys). MHS: 8 m (2 storeys). THAB: 16 m. Are these modelled as hard caps? If so, how does the system obtain the proposed building height — user input, GFA ÷ footprint estimate, or a fixed assumption per zone?

3. **Density cap without consent** — MHU permits up to 3 dwellings per site as a permitted activity. More than 3 requires a resource consent pathway. Does `runAudit`'s yield scoring need a density cap, and does the system flag the consent pathway when yield > 3?

4. **Setback polygons** — MHU: front 1.5 m, rear 1 m, side 1 m (for buildings ≤ 4 m). Computing setback polygons requires inward-offsetting the parcel boundary ring by a metric distance. In degree-space this is not valid — it requires projection to EPSG:2193 or a metric offset library (see Branch 1 Q3). What is the plan?

5. **Split-zone parcels** — A parcel can straddle two AUP zones; LINZ returns one geometry but the AUP zone boundary may bisect it. Does the system query the AUP GIS layer (Auckland Council FeatureServer) for zone coverage per parcel, or accept a single `AUPZoneCode` as a trusted input? If the latter, who validates it?

6. **`auditor.ts` ↔ `AUPZoneCode` alignment** — `auditor.ts` uses `'Mixed Housing Urban'` (raw string); `infrastructure-ghost.ts` exports `AUPZoneCode = "MHU" | "MHS" | "THAB"`. These two surfaces must be unified before any HIRB, setback, or density logic is added. Who owns the canonical zone type, and which file is the source of truth?

---

## Resolution Checklist

Before signing off on any spatial feature implementation, every item below must be checked:

- [ ] CRS of every input coordinate is declared and validated at the API boundary
- [ ] Projection step (EPSG:2193 ↔ 4326) is owned by a named component
- [ ] Metric area/offset calculations use a projected CRS or documented Haversine compensation
- [ ] MultiPolygon handling is explicit: adapter written, or `PARSE_ERROR` returned with documented rationale
- [ ] "Best part" selection rule for MultiPolygon is documented
- [ ] `AUPZoneCode` is the canonical type everywhere — `auditor.ts` raw string is eliminated or mapped
- [ ] HIRB scope decision is recorded (in or out of scope, with AUP chapter reference)
- [ ] Height limit, setback, and density rules are either modelled or explicitly deferred with a reason
- [ ] Split-zone parcel strategy is documented

## Output

A written design decision record — one paragraph per branch — confirming the resolution of every item above. Paste into a GitHub issue, an ADR, or a comment block at the top of the new engine file before writing any implementation code.
