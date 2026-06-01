/**
 * infrastructure-ghost.ts
 * TerraAI — Council infrastructure capacity fault detector.
 *
 * Accepts property parcel geometry and council asset data (Wastewater /
 * Stormwater pipes) and returns a risk-rated InfrastructureReport with
 * cost-impact estimates.
 *
 * Risk rules:
 *   HIGH_RISK if: pipe utilisation > 90 %
 *   HIGH_RISK if: pipe centreline passes through the parcel's buildable area
 *   MEDIUM_RISK if: pipe utilisation 70–90 %
 *   LOW_RISK otherwise
 */

// ─── Geometry Primitives ──────────────────────────────────────────────────────

/** A 2-D point [longitude, latitude] in WGS-84. */
export type Point2D = [number, number];

/** Closed ring of coordinates (first === last). */
export type Ring = Point2D[];

/** Simple polygon with an optional array of hole rings. */
export interface SimplePolygon {
  exterior: Ring;
  holes?: Ring[];
}

// ─── Council Asset Types ──────────────────────────────────────────────────────

export type PipeType = "Wastewater" | "Stormwater" | "Combined";
export type PipeMaterial = "PVC" | "Concrete" | "Clay" | "Cast Iron" | "HDPE" | "Unknown";

/** A single council infrastructure pipe asset. */
export interface CouncilPipe {
  /** Council GIS asset identifier */
  asset_id: string;
  type: PipeType;
  material: PipeMaterial;
  /** Internal diameter in millimetres */
  diameter_mm: number;
  /**
   * Current utilisation expressed as a percentage of design capacity (0–100).
   * Values over 100 indicate surcharging.
   */
  capacity_pct: number;
  /** Age of the pipe in years */
  age_years: number;
  /** GeoJSON LineString coordinates: array of [lng, lat] points */
  centreline: Point2D[];
}

/** Parcel geometry passed in from LINZ or manual input. */
export interface ParcelGeometry {
  /** The legal boundary of the entire parcel */
  parcel_boundary: SimplePolygon;
  /**
   * The developable/buildable area after setbacks.
   * If not supplied, the full parcel boundary is used.
   */
  buildable_area?: SimplePolygon;
}

// ─── Fault & Report Types ─────────────────────────────────────────────────────

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface CapacityFault {
  asset_id: string;
  pipe_type: PipeType;
  risk_level: RiskLevel;
  /** Human-readable description of why this fault was raised */
  reason: string;
  /**
   * Estimated cost impact in NZD.
   * This is a rough order-of-magnitude figure for developer budgeting.
   */
  estimated_cost_impact_nzd: number;
  /** Confidence in the cost estimate: 0–1 */
  cost_confidence: number;
}

export interface InfrastructureReport {
  /** Total number of pipes assessed */
  pipes_assessed: number;
  /** All identified faults, sorted by severity (highest first) */
  faults: CapacityFault[];
  /** Highest risk level found across all faults */
  overall_risk: RiskLevel;
  /** Sum of all estimated cost impacts in NZD */
  total_estimated_cost_nzd: number;
  /**
   * Qualitative infrastructure verdict.
   * e.g. "Significant upgrades likely required before consent."
   */
  verdict: string;
}

// ─── Geometry Utilities ───────────────────────────────────────────────────────

/**
 * Ray-casting algorithm: returns true if the point is inside the polygon ring.
 * Works for simple (non-self-intersecting) polygons in WGS-84 space.
 */
function pointInRing(point: Point2D, ring: Ring): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Returns true if `point` is inside `polygon` (accounting for holes).
 */
function pointInPolygon(point: Point2D, polygon: SimplePolygon): boolean {
  if (!pointInRing(point, polygon.exterior)) return false;
  // If point is in a hole, it is outside the polygon
  if (polygon.holes) {
    for (const hole of polygon.holes) {
      if (pointInRing(point, hole)) return false;
    }
  }
  return true;
}

/**
 * Returns true if any segment of the pipe centreline intersects or passes
 * through the polygon (checks every vertex and midpoint of each segment).
 */
function pipeIntersectsPolygon(
  centreline: Point2D[],
  polygon: SimplePolygon
): boolean {
  for (let i = 0; i < centreline.length; i++) {
    if (pointInPolygon(centreline[i], polygon)) return true;
    // Also check the midpoint of each segment for better coverage
    if (i < centreline.length - 1) {
      const mid: Point2D = [
        (centreline[i][0] + centreline[i + 1][0]) / 2,
        (centreline[i][1] + centreline[i + 1][1]) / 2,
      ];
      if (pointInPolygon(mid, polygon)) return true;
    }
  }
  return false;
}

// ─── Cost-Impact Estimation ───────────────────────────────────────────────────

/**
 * NZD cost-impact lookup table.
 *
 * Figures are conservative order-of-magnitude estimates based on NZ
 * infrastructure construction pricing (2024).  They cover design,
 * consent, and construction but NOT land holding or finance costs.
 */
const COST_IMPACT: Record<
  "HIGH_CAPACITY" | "PIPE_THROUGH_SITE" | "MEDIUM_CAPACITY",
  Record<PipeType, number>
> = {
  HIGH_CAPACITY: {
    Wastewater: 180_000,
    Stormwater: 120_000,
    Combined: 250_000,
  },
  PIPE_THROUGH_SITE: {
    // Easement negotiation + pipe protection or diversion
    Wastewater: 95_000,
    Stormwater: 65_000,
    Combined: 140_000,
  },
  MEDIUM_CAPACITY: {
    Wastewater: 40_000,
    Stormwater: 25_000,
    Combined: 60_000,
  },
};

// ─── Risk Helpers ─────────────────────────────────────────────────────────────

function capacityRiskLevel(capacity_pct: number): RiskLevel {
  if (capacity_pct > 100) return "CRITICAL";
  if (capacity_pct > 90) return "HIGH";
  if (capacity_pct > 70) return "MEDIUM";
  return "LOW";
}

function highestRisk(levels: RiskLevel[]): RiskLevel {
  const order: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  return levels.reduce(
    (max, lvl) => (order.indexOf(lvl) > order.indexOf(max) ? lvl : max),
    "LOW" as RiskLevel
  );
}

function verdictFromRisk(risk: RiskLevel, faultCount: number): string {
  if (faultCount === 0) return "No infrastructure faults detected. Clear for development.";
  switch (risk) {
    case "CRITICAL":
      return "Critical infrastructure failure risk. Development consent unlikely without major network upgrades.";
    case "HIGH":
      return "Significant infrastructure constraints identified. Budget for network upgrades before lodging consent.";
    case "MEDIUM":
      return "Moderate infrastructure pressure. Obtain formal capacity confirmation from council before proceeding.";
    case "LOW":
      return "Minor infrastructure considerations. Standard consent conditions expected.";
  }
}

// ─── Main Ghost Analyser ──────────────────────────────────────────────────────

/**
 * Analyses council pipe assets against a parcel and returns an
 * InfrastructureReport with all identified CapacityFaults.
 *
 * @param parcelGeometry  - Parcel boundary (and optional buildable area)
 * @param pipes           - Array of council wastewater/stormwater pipe assets
 */
export function analyseInfrastructure(
  parcelGeometry: ParcelGeometry,
  pipes: CouncilPipe[]
): InfrastructureReport {
  const buildableArea = parcelGeometry.buildable_area ?? parcelGeometry.parcel_boundary;
  const faults: CapacityFault[] = [];

  for (const pipe of pipes) {
    const capacityRisk = capacityRiskLevel(pipe.capacity_pct);
    const pipeThrough = pipeIntersectsPolygon(pipe.centreline, buildableArea);

    // ── Rule 1: Capacity > 90 % ──────────────────────────────────────────────
    if (capacityRisk === "HIGH" || capacityRisk === "CRITICAL") {
      faults.push({
        asset_id: pipe.asset_id,
        pipe_type: pipe.type,
        risk_level: capacityRisk,
        reason:
          `${pipe.type} pipe (${pipe.asset_id}) is operating at ` +
          `${pipe.capacity_pct.toFixed(1)}% capacity — ` +
          `${capacityRisk === "CRITICAL" ? "surcharging" : "above 90% threshold"}.`,
        estimated_cost_impact_nzd:
          COST_IMPACT.HIGH_CAPACITY[pipe.type],
        cost_confidence: 0.65,
      });
    }

    // ── Rule 2: Pipe runs through buildable area ─────────────────────────────
    if (pipeThrough) {
      // If a capacity fault already exists for this pipe, upgrade its cost
      const existing = faults.find(
        (f) => f.asset_id === pipe.asset_id && f.risk_level === "HIGH"
      );
      if (existing) {
        // Combined fault: add pipe-through cost on top
        existing.estimated_cost_impact_nzd +=
          COST_IMPACT.PIPE_THROUGH_SITE[pipe.type];
        existing.reason +=
          " Additionally, the pipe centreline passes through the buildable area — easement or diversion required.";
      } else {
        faults.push({
          asset_id: pipe.asset_id,
          pipe_type: pipe.type,
          risk_level: "HIGH",
          reason:
            `${pipe.type} pipe (${pipe.asset_id}) runs directly through the ` +
            `buildable area. Easement restrictions or diversion costs apply.`,
          estimated_cost_impact_nzd:
            COST_IMPACT.PIPE_THROUGH_SITE[pipe.type],
          cost_confidence: 0.75,
        });
      }
    }

    // ── Rule 3: Capacity 70–90 % (medium flag, no pipe-through overlap) ──────
    if (capacityRisk === "MEDIUM" && !pipeThrough) {
      faults.push({
        asset_id: pipe.asset_id,
        pipe_type: pipe.type,
        risk_level: "MEDIUM",
        reason:
          `${pipe.type} pipe (${pipe.asset_id}) is at ` +
          `${pipe.capacity_pct.toFixed(1)}% capacity. Additional loading from ` +
          `new development may trigger a network upgrade requirement.`,
        estimated_cost_impact_nzd:
          COST_IMPACT.MEDIUM_CAPACITY[pipe.type],
        cost_confidence: 0.5,
      });
    }
  }

  // Sort by severity descending
  const riskOrder: RiskLevel[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  faults.sort(
    (a, b) => riskOrder.indexOf(a.risk_level) - riskOrder.indexOf(b.risk_level)
  );

  const overallRisk = highestRisk(faults.map((f) => f.risk_level));
  const totalCost = faults.reduce(
    (sum, f) => sum + f.estimated_cost_impact_nzd,
    0
  );

  return {
    pipes_assessed: pipes.length,
    faults,
    overall_risk: overallRisk,
    total_estimated_cost_nzd: totalCost,
    verdict: verdictFromRisk(overallRisk, faults.length),
  };
}

// ─── AuditVerdict slice ───────────────────────────────────────────────────────

/**
 * The infrastructure section of an AuditVerdict.
 * Combined with LINZAuditSlice and ValuationResult in valuation-engine.ts.
 */
export interface InfrastructureAuditSlice {
  report: InfrastructureReport;
}

// ─── Auckland Constraint Constants ───────────────────────────────────────────

/**
 * Public stormwater/wastewater pipe corridor deduction.
 * Assumes an 18 m pipe centreline with a 3 m total clearance corridor = 54 m².
 */
const STORMWATER_PIPE_CORRIDOR_DEDUCTION_M2 = 54;

/**
 * Overland flow path buffer zone deduction applied when the constraint is
 * active on the parcel.
 */
const OVERLAND_FLOW_PATH_DEDUCTION_M2 = 120;

// ─── NBE Deduction Types ──────────────────────────────────────────────────────

/** Auckland-specific council constraints that reduce net buildable land area. */
export interface AucklandConstraints {
  /** Whether a public stormwater/wastewater pipe corridor crosses the parcel. */
  has_stormwater_pipe_corridor: boolean;
  /** Whether an overland flow path constraint is currently active on the parcel. */
  has_overland_flow_path: boolean;
}

/** Area deductions (in m²) applied to derive the Net Buildable Envelope. */
export interface LandAreaDeduction {
  /** Area removed by stormwater/wastewater pipe clearance corridor (54 m² per pipe). */
  stormwater_pipe_corridor_m2: number;
  /** Area removed by overland flow path buffer zone (120 m² if active). */
  overland_flow_path_m2: number;
  /** Combined total deduction in m². */
  total_deduction_m2: number;
}

// ─── NBE Deduction Calculator ─────────────────────────────────────────────────

/**
 * Calculates land area deductions from Auckland-specific council constraints.
 *
 * Two constraints are evaluated:
 *  1. Public stormwater/wastewater pipe corridor: an 18 m pipe with a 3 m
 *     total clearance corridor deducts 54 m² from the net buildable area.
 *  2. Overland flow path: a flat 120 m² buffer zone is deducted when the
 *     constraint is active on the parcel.
 *
 * @param parcelGeometry  - Parcel boundary used for spatial context.
 * @param constraints     - Boolean flags indicating which Auckland constraints are active.
 */
export function calculateLandAreaDeductions(
  parcelGeometry: ParcelGeometry,
  constraints: AucklandConstraints
): LandAreaDeduction {
  // parcelGeometry is retained as a parameter for spatial context and future
  // integration with GIS intersection checks.
  void parcelGeometry;

  const stormwaterDeduction = constraints.has_stormwater_pipe_corridor
    ? STORMWATER_PIPE_CORRIDOR_DEDUCTION_M2
    : 0;

  const overlandFlowDeduction = constraints.has_overland_flow_path
    ? OVERLAND_FLOW_PATH_DEDUCTION_M2
    : 0;

  return {
    stormwater_pipe_corridor_m2: stormwaterDeduction,
    overland_flow_path_m2: overlandFlowDeduction,
    total_deduction_m2: stormwaterDeduction + overlandFlowDeduction,
  };
}

// ─── Auckland Council GIS — API Constants ────────────────────────────────────

/**
 * Auckland Council ArcGIS FeatureServer base URL.
 *
 * Both layers are served via the Auckland Council ArcGIS REST API with
 * standard FeatureServer query parameters.  The `f=geojson` output format
 * is used throughout.
 *
 * Layer references (Auckland Council Open Data):
 *   Stormwater & Wastewater Asset Network  — service ID as per AKL open data portal
 *   Catchments & Overland Flow Paths       — service ID as per AKL open data portal
 */
const AKL_GIS_BASE =
  "https://gis.aucklandcouncil.govt.nz/arcgis/rest/services";

const AKL_PIPE_NETWORK_URL =
  `${AKL_GIS_BASE}/Infrastructure/StormwaterWastewaterAssetNetwork/FeatureServer/0/query`;

const AKL_FLOW_PATH_URL =
  `${AKL_GIS_BASE}/Hydrology/CatchmentsAndOverlandFlowPaths/FeatureServer/0/query`;

// ─── Auckland Council GIS — Feature Types ────────────────────────────────────

/** Properties of a single pipe segment from the AKL asset network layer. */
export interface AKLPipeProperties {
  /** Council GIS asset identifier */
  ASSET_ID: string;
  /** "Stormwater" | "Wastewater" | "Combined" */
  ASSET_TYPE: string;
  /** Internal diameter in millimetres */
  DIAMETER_MM: number | null;
  /** Pipe material */
  MATERIAL: string | null;
  /** Design capacity utilisation 0–100 (may be null for older assets) */
  CAPACITY_PCT: number | null;
}

/** A single pipe segment feature from the AKL Stormwater/Wastewater layer. */
export interface AKLPipeFeature {
  type: "Feature";
  geometry: {
    type: "LineString";
    /** Array of [lng, lat] coordinate pairs. */
    coordinates: Point2D[];
  };
  properties: AKLPipeProperties;
}

/** GeoJSON FeatureCollection returned by the AKL pipe network query. */
export interface AKLPipeFeatureCollection {
  type: "FeatureCollection";
  features: AKLPipeFeature[];
}

/** Properties of a single overland flow path feature from the AKL hydrology layer. */
export interface AKLFlowPathProperties {
  /** Catchment identifier */
  CATCHMENT_ID: string | null;
  /** Flow path classification, e.g. "Primary" | "Secondary" */
  FLOW_TYPE: string | null;
}

/** A single overland flow path feature. */
export interface AKLFlowPathFeature {
  type: "Feature";
  geometry: {
    type: "LineString" | "MultiLineString";
    /** LineString: Point2D[]; MultiLineString: Point2D[][] */
    coordinates: Point2D[] | Point2D[][];
  };
  properties: AKLFlowPathProperties;
}

/** GeoJSON FeatureCollection returned by the AKL overland flow path query. */
export interface AKLFlowPathFeatureCollection {
  type: "FeatureCollection";
  features: AKLFlowPathFeature[];
}

// ─── Auckland Council GIS — Bounding Box Query Builder ───────────────────────

/**
 * Builds an ArcGIS FeatureServer query URL for spatial intersection against
 * the supplied parcel ring.
 *
 * The envelope is derived from the exterior ring min/max and passed as an
 * `esriGeometryEnvelope` with `esriSpatialRelIntersects` to return every
 * feature whose geometry overlaps the parcel bounding box.
 *
 * @param endpointUrl - FeatureServer layer query endpoint.
 * @param apiKey      - Auckland Council API key (sent as `token` parameter).
 * @param ring        - Exterior ring of the parcel boundary.
 */
function buildAKLQueryUrl(
  endpointUrl: string,
  apiKey: string,
  ring: Ring
): string {
  const lngs = ring.map((pt) => pt[0]);
  const lats = ring.map((pt) => pt[1]);
  const xmin = Math.min(...lngs);
  const ymin = Math.min(...lats);
  const xmax = Math.max(...lngs);
  const ymax = Math.max(...lats);

  // ArcGIS REST envelope JSON: { xmin, ymin, xmax, ymax, spatialReference: { wkid } }
  const envelope = JSON.stringify({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 } });

  const params = new URLSearchParams({
    geometry: envelope,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
    token: apiKey,
  });

  return `${endpointUrl}?${params.toString()}`;
}

// ─── Auckland Council GIS — Network Fetchers ─────────────────────────────────

/**
 * Queries the Auckland Council Stormwater & Wastewater Asset Network layer
 * for all pipe segments whose geometry intersects the parcel bounding box.
 *
 * @param apiKey         - Auckland Council API key.
 * @param parcelGeometry - Parcel boundary from which the bbox is derived.
 */
export async function fetchAKLPipeNetwork(
  apiKey: string,
  parcelGeometry: ParcelGeometry
): Promise<AKLPipeFeatureCollection> {
  const ring = parcelGeometry.parcel_boundary.exterior;
  const url = buildAKLQueryUrl(AKL_PIPE_NETWORK_URL, apiKey, ring);

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(
      `AKL pipe network query failed — HTTP ${response.status}: ${response.statusText}`
    );
  }
  return (await response.json()) as AKLPipeFeatureCollection;
}

/**
 * Queries the Auckland Council Catchments & Overland Flow Paths layer for all
 * flow path vectors that intersect the parcel bounding box.
 *
 * @param apiKey         - Auckland Council API key.
 * @param parcelGeometry - Parcel boundary from which the bbox is derived.
 */
export async function fetchAKLOverlandFlowPaths(
  apiKey: string,
  parcelGeometry: ParcelGeometry
): Promise<AKLFlowPathFeatureCollection> {
  const ring = parcelGeometry.parcel_boundary.exterior;
  const url = buildAKLQueryUrl(AKL_FLOW_PATH_URL, apiKey, ring);

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(
      `AKL overland flow path query failed — HTTP ${response.status}: ${response.statusText}`
    );
  }
  return (await response.json()) as AKLFlowPathFeatureCollection;
}

// ─── Spatial Analysis — Pipe Intersect Length ────────────────────────────────

/**
 * Haversine great-circle distance between two WGS-84 points, in metres.
 */
function haversineDistance(a: Point2D, b: Point2D): number {
  const R = 6_371_000;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Returns the parametric intersection point of two 2-D line segments
 * [a1→a2] and [b1→b2], or null if they do not intersect within their extents.
 */
function segmentIntersection(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D
): Point2D | null {
  const dx1 = a2[0] - a1[0];
  const dy1 = a2[1] - a1[1];
  const dx2 = b2[0] - b1[0];
  const dy2 = b2[1] - b1[1];
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-12) return null; // parallel or collinear

  const t = ((b1[0] - a1[0]) * dy2 - (b1[1] - a1[1]) * dx2) / denom;
  const u = ((b1[0] - a1[0]) * dy1 - (b1[1] - a1[1]) * dx1) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return [a1[0] + t * dx1, a1[1] + t * dy1];
}

/**
 * Computes the total length (metres) of a single pipe segment [p1→p2] that
 * lies strictly inside the parcel polygon.
 *
 * Algorithm:
 *   1. Classify each endpoint as inside/outside the polygon (ray-cast).
 *   2. Find all boundary crossing points along the segment.
 *   3. Walk the sorted crossing list and sum interior sub-segments.
 */
function clipSegmentToPolygon(
  p1: Point2D,
  p2: Point2D,
  polygon: SimplePolygon
): number {
  const p1In = pointInPolygon(p1, polygon);
  const p2In = pointInPolygon(p2, polygon);

  // Collect all crossing points with the exterior ring, sorted by t ∈ [0,1].
  const crossings: Array<{ t: number; pt: Point2D }> = [];
  const ring = polygon.exterior;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ix = segmentIntersection(p1, p2, ring[j], ring[i]);
    if (ix !== null) {
      const dx = p2[0] - p1[0];
      const dy = p2[1] - p1[1];
      const t =
        Math.abs(dx) > Math.abs(dy)
          ? (ix[0] - p1[0]) / dx
          : (ix[1] - p1[1]) / dy;
      crossings.push({ t, pt: ix });
    }
  }
  crossings.sort((a, b) => a.t - b.t);

  // Both endpoints inside — the whole segment is interior.
  if (p1In && p2In) {
    return haversineDistance(p1, p2);
  }

  // Neither endpoint inside — segment may cross the polygon twice.
  if (!p1In && !p2In) {
    if (crossings.length < 2) return 0;
    let total = 0;
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      total += haversineDistance(crossings[i].pt, crossings[i + 1].pt);
    }
    return total;
  }

  // p1 inside, p2 outside — measure from p1 to first exit crossing.
  if (p1In && crossings.length > 0) {
    return haversineDistance(p1, crossings[0].pt);
  }

  // p2 inside, p1 outside — measure from last entry crossing to p2.
  if (p2In && crossings.length > 0) {
    return haversineDistance(crossings[crossings.length - 1].pt, p2);
  }

  return 0;
}

/**
 * Calculates the total length (metres) of all pipe centrelines from the
 * supplied AKL pipe feature collection that intersect the parcel boundary.
 *
 * Each segment of each pipe's LineString is individually clipped to the
 * parcel polygon and its interior length accumulated.
 *
 * @param pipes          - AKL pipe features returned by fetchAKLPipeNetwork().
 * @param parcelGeometry - Parcel boundary for clipping.
 */
export function computePipeIntersectLength(
  pipes: AKLPipeFeatureCollection,
  parcelGeometry: ParcelGeometry
): number {
  const polygon: SimplePolygon = parcelGeometry.parcel_boundary;
  let totalMetres = 0;

  for (const feature of pipes.features) {
    const coords = feature.geometry.coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
      totalMetres += clipSegmentToPolygon(coords[i], coords[i + 1], polygon);
    }
  }

  return totalMetres;
}

// ─── Spatial Analysis — Overland Flow Path Detection ─────────────────────────

/**
 * Returns true if any overland flow path vector in the collection intersects
 * the parcel boundary polygon.
 *
 * Supports both LineString and MultiLineString geometry types.
 * A single vertex inside the parcel or any segment crossing the boundary
 * is sufficient to return true.
 *
 * @param flowPaths      - AKL flow path features returned by fetchAKLOverlandFlowPaths().
 * @param parcelGeometry - Parcel boundary for intersection testing.
 */
export function detectOverlandFlowIntersection(
  flowPaths: AKLFlowPathFeatureCollection,
  parcelGeometry: ParcelGeometry
): boolean {
  const polygon: SimplePolygon = parcelGeometry.parcel_boundary;

  for (const feature of flowPaths.features) {
    const { type, coordinates } = feature.geometry;

    const lineStrings: Point2D[][] =
      type === "LineString"
        ? [coordinates as Point2D[]]
        : (coordinates as Point2D[][]);

    for (const line of lineStrings) {
      for (let i = 0; i < line.length; i++) {
        // Check every vertex.
        if (pointInPolygon(line[i], polygon)) return true;

        // Check segment midpoints for lines that span across the parcel
        // without a vertex landing inside.
        if (i < line.length - 1) {
          const mid: Point2D = [
            (line[i][0] + line[i + 1][0]) / 2,
            (line[i][1] + line[i + 1][1]) / 2,
          ];
          if (pointInPolygon(mid, polygon)) return true;

          // Full segment intersection check against the exterior ring.
          const ring = polygon.exterior;
          for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
            if (segmentIntersection(line[i], line[i + 1], ring[k], ring[j]) !== null) {
              return true;
            }
          }
        }
      }
    }
  }

  return false;
}

// ─── Constraint Deriver — live GIS → AucklandConstraints ─────────────────────

/**
 * Orchestrates live Auckland Council GIS queries and derives the
 * `AucklandConstraints` payload that feeds into `calculateLandAreaDeductions()`.
 *
 * Workflow:
 *   1. Fetch pipe network features intersecting the parcel bbox.
 *   2. Fetch overland flow path features intersecting the parcel bbox.
 *   3. Compute the true pipe intersect length within the parcel boundary.
 *   4. Test every flow path vector for a precise parcel intersection.
 *   5. Return `AucklandConstraints` with dynamically resolved boolean flags.
 *
 * The pipe corridor flag is set true when at least one pipe segment is found
 * inside the parcel boundary (non-zero intersect length).  The overland flow
 * flag mirrors the boolean result from `detectOverlandFlowIntersection()`.
 *
 * @param apiKey         - Auckland Council GIS API key.
 * @param parcelGeometry - Parcel boundary geometry.
 *
 * @returns Resolved constraints and diagnostic metadata.
 */
export async function deriveAucklandConstraints(
  apiKey: string,
  parcelGeometry: ParcelGeometry
): Promise<{
  constraints: AucklandConstraints;
  diagnostics: {
    pipe_intersect_length_m: number;
    flow_path_features_found: number;
  };
}> {
  const [pipeCollection, flowPathCollection] = await Promise.all([
    fetchAKLPipeNetwork(apiKey, parcelGeometry),
    fetchAKLOverlandFlowPaths(apiKey, parcelGeometry),
  ]);

  const pipeIntersectLengthM = computePipeIntersectLength(
    pipeCollection,
    parcelGeometry
  );

  const hasOverlandFlow = detectOverlandFlowIntersection(
    flowPathCollection,
    parcelGeometry
  );

  return {
    constraints: {
      has_stormwater_pipe_corridor: pipeIntersectLengthM > 0,
      has_overland_flow_path: hasOverlandFlow,
    },
    diagnostics: {
      pipe_intersect_length_m: Math.round(pipeIntersectLengthM * 100) / 100,
      flow_path_features_found: flowPathCollection.features.length,
    },
  };
}

// ─── Auckland Council Open Data — ArcGIS FeatureServer URLs ─────────────────────────

/**
 * ArcGIS FeatureServer endpoints for the Auckland Council Open Data portal
 * (services2.arcgis.com).  Publicly accessible — no token required.
 */
const ARCGIS_CONDUIT_URL =
  "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/Stormwater_Conduits/FeatureServer/0/query";

const ARCGIS_FLOW_PATH_URL =
  "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/Overland_Flow_Paths/FeatureServer/0/query";

// ─── ArcGIS Response Types ─────────────────────────────────────────────────────

/** Minimal line feature as returned by both ArcGIS FeatureServer layers. */
interface ArcGISLineFeature {
  type: "Feature";
  geometry: {
    type: "LineString" | "MultiLineString";
    /** LineString: Point2D[]; MultiLineString: Point2D[][] */
    coordinates: Point2D[] | Point2D[][];
  } | null;
  properties: Record<string, unknown>;
}

/** GeoJSON FeatureCollection envelope returned by the ArcGIS FeatureServer. */
interface ArcGISFeatureCollection {
  type: "FeatureCollection";
  features: ArcGISLineFeature[];
}

// ─── LocalConstraintResult ────────────────────────────────────────────────────────────

/** Resolved result from a live Auckland Council ArcGIS constraint query. */
export interface LocalConstraintResult {
  /**
   * Total length (metres) of public stormwater conduit assets whose geometry
   * intersects the supplied parcel bounding box, summed across all segments.
   */
  publicAssetEasementLength: number;
  /**
   * Corridor deduction area (m²) = `publicAssetEasementLength × 3 m` clearance
   * width.  Zero when no conduit features are returned.
   */
  corridorDeductionM2: number;
  /**
   * True when one or more overland flow path features intersect the parcel
   * bounding box (API-level spatial filter; no further intersection test required).
   */
  hasOverlandFlowPath: boolean;
  /** Resolved constraint flags for use with `calculateLandAreaDeductions()`. */
  constraints: AucklandConstraints;
  /** Raw feature counts from each API response for audit logging. */
  diagnostics: {
    conduit_features_found: number;
    flow_path_features_found: number;
  };
}

// ─── fetchLocalConstraints ──────────────────────────────────────────────────────────

/**
 * Fires parallel fetch requests to the Auckland Council ArcGIS REST API for
 * stormwater conduits and overland flow paths that intersect the given parcel
 * bounding box, then derives the infrastructure deduction figures for the NBE
 * calculation.
 *
 * Both requests share the same ArcGIS query parameters:
 *   - `f=geojson`                              — GeoJSON output
 *   - `geometryType=esriGeometryEnvelope`      — bbox spatial filter
 *   - `geometry=${bbox}`                       — caller-supplied envelope
 *   - `spatialRel=esriSpatialRelIntersects`    — any intersection
 *   - `outFields=*`                            — all attributes
 *
 * @param bbox - Comma-delimited ArcGIS envelope string in EPSG:4326:
 *               `"xmin,ymin,xmax,ymax"` (i.e. `"minLng,minLat,maxLng,maxLat"`).
 *               Example: `"174.7900,-36.8790,174.7920,-36.8760"`
 *
 * @returns Easement length, corridor deduction area, overland flow flag, and
 *          `AucklandConstraints` ready for `calculateLandAreaDeductions()`.
 *
 * @throws  If either HTTP request fails (non-2xx status).
 */
export async function fetchLocalConstraints(
  bbox: string
): Promise<LocalConstraintResult> {
  const params = new URLSearchParams({
    f: "geojson",
    geometryType: "esriGeometryEnvelope",
    geometry: bbox,
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
  });
  const queryString = params.toString();

  // Fire both layer requests in parallel — no inter-dependency.
  const [conduitsRes, flowPathsRes] = await Promise.all([
    fetch(`${ARCGIS_CONDUIT_URL}?${queryString}`, {
      headers: { Accept: "application/json" },
    }),
    fetch(`${ARCGIS_FLOW_PATH_URL}?${queryString}`, {
      headers: { Accept: "application/json" },
    }),
  ]);

  if (!conduitsRes.ok) {
    throw new Error(
      `Stormwater conduits query failed — HTTP ${conduitsRes.status}: ${conduitsRes.statusText}`
    );
  }
  if (!flowPathsRes.ok) {
    throw new Error(
      `Overland flow paths query failed — HTTP ${flowPathsRes.status}: ${flowPathsRes.statusText}`
    );
  }

  const [conduits, flowPaths] = (await Promise.all([
    conduitsRes.json(),
    flowPathsRes.json(),
  ])) as [ArcGISFeatureCollection, ArcGISFeatureCollection];

  // ── Conduit length summation ──────────────────────────────────────────────────────────
  // Every feature returned by the ArcGIS query already intersects the bbox
  // (server-side spatial filter). Walk all segments and accumulate haversine
  // arc-lengths so the deduction reflects the true in-parcel pipe run.
  let publicAssetEasementLength = 0;

  for (const feature of conduits.features) {
    if (!feature.geometry) continue;

    // Normalise LineString and MultiLineString to a common array of rings.
    const lineStrings: Point2D[][] =
      feature.geometry.type === "LineString"
        ? [feature.geometry.coordinates as Point2D[]]
        : (feature.geometry.coordinates as Point2D[][]);

    for (const line of lineStrings) {
      for (let i = 0; i < line.length - 1; i++) {
        publicAssetEasementLength += haversineDistance(line[i], line[i + 1]);
      }
    }
  }

  // Corridor deduction = total easement length × 3 m clearance width.
  // Set to 0 when no conduit features are present in the parcel bbox.
  const corridorDeductionM2 =
    conduits.features.length > 0
      ? Math.round(publicAssetEasementLength * 3)
      : 0;

  // ── Overland flow path detection ─────────────────────────────────────────────────
  // The ArcGIS spatial filter guarantees every returned feature intersects the
  // parcel bbox. A non-zero feature count is sufficient to set the flag.
  const hasOverlandFlowPath = flowPaths.features.length > 0;

  return {
    publicAssetEasementLength: Math.round(publicAssetEasementLength * 100) / 100,
    corridorDeductionM2,
    hasOverlandFlowPath,
    constraints: {
      has_stormwater_pipe_corridor: conduits.features.length > 0,
      has_overland_flow_path: hasOverlandFlowPath,
    },
    diagnostics: {
      conduit_features_found: conduits.features.length,
      flow_path_features_found: flowPaths.features.length,
    },
  };
}

// ─── Auckland Unitary Plan — Zone Coverage Profiles ──────────────────────────

/** Supported Auckland Unitary Plan (AUP) residential zone codes. */
export type AUPZoneCode = "MHU" | "MHS" | "THAB";

/** Legal building coverage parameters for a single AUP zone. */
export interface AUPZoneProfile {
  /** Human-readable zone description. */
  description: string;
  /**
   * Maximum site coverage expressed as a percentage of gross site area (0–100).
   * Sourced from the Auckland Unitary Plan Operative in Part.
   */
  max_coverage_pct: number;
}

/**
 * Auckland Unitary Plan residential zone profiles.
 *
 * Sources:
 *   MHU  — AUP Chapter H4: Mixed Housing Urban Zone           (max 45% site coverage).
 *   MHS  — AUP Chapter H3: Mixed Housing Suburban Zone        (max 40% site coverage).
 *   THAB — AUP Chapter H5: Terrace Housing and Apartment Buildings Zone (max 50%).
 */
export const AUP_ZONE_PROFILES: Record<AUPZoneCode, AUPZoneProfile> = {
  MHU: {
    description: "Mixed Housing Urban",
    max_coverage_pct: 45,
  },
  MHS: {
    description: "Mixed Housing Suburban",
    max_coverage_pct: 40,
  },
  THAB: {
    description: "Terrace Housing & Apartments",
    max_coverage_pct: 50,
  },
};

/**
 * Resolves the legal coverage deduction for a given AUP zone.
 *
 * The deduction represents the area of the gross site that cannot legally
 * carry building coverage — i.e. `gross_area_m2 × (1 − max_coverage_pct / 100)`.
 * This figure is applied to the gross area **before** physical infrastructure
 * deductions so that the Net Buildable Envelope captures both the legal cap
 * and structural constraints cumulatively.
 *
 * @param zone           - AUP zone code ("MHU" | "MHS" | "THAB").
 * @param gross_area_m2  - Total parcel area in m² from LINZ calc_area.
 */
export function resolveZoneCoverageDeduction(
  zone: AUPZoneCode,
  gross_area_m2: number
): {
  zone: AUPZoneCode;
  description: string;
  max_coverage_pct: number;
  /** Area legally available for building coverage (m²). */
  legal_coverage_area_m2: number;
  /** Area deducted from gross site area due to the zone coverage limit (m²). */
  zone_deduction_m2: number;
} {
  const profile = AUP_ZONE_PROFILES[zone];
  const legal_coverage_area_m2 = Math.round(gross_area_m2 * (profile.max_coverage_pct / 100));
  const zone_deduction_m2 = gross_area_m2 - legal_coverage_area_m2;

  return {
    zone,
    description: profile.description,
    max_coverage_pct: profile.max_coverage_pct,
    legal_coverage_area_m2,
    zone_deduction_m2,
  };
}

