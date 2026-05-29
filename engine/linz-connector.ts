/**
 * linz-connector.ts
 * TerraAI — LINZ Primary Parcels (Layer 50772) connector.
 *
 * Fetches parcel data from the LINZ WFS API using a coordinate pair and
 * returns statutory_area and parcel_intent for the matching parcel.
 *
 * LINZ WFS docs: https://www.linz.govt.nz/data/linz-data-service/guides-and-documentation/wfs-spatial-filtering
 */

// ─── Coordinate Types ────────────────────────────────────────────────────────

/** WGS-84 coordinate pair (EPSG:4326). */
export interface Coordinate {
  /** Decimal degrees, e.g. 174.7633 */
  lng: number;
  /** Decimal degrees, e.g. -36.8485 */
  lat: number;
}

// ─── LINZ WFS Response Types ─────────────────────────────────────────────────

/** Raw geometry as returned by the LINZ WFS GeoJSON output. */
export interface LINZGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
}

/** Raw feature properties from LINZ Layer 50772 (Primary Parcels). */
export interface LINZParcelProperties {
  id: number;
  appellation: string | null;
  affected_surveys: string | null;
  parcel_intent: string | null;
  topology_type: string | null;
  statutory_actions: string | null;
  land_district: string | null;
  titles: string | null;
  survey_area: number | null;
  calc_area: number | null;
  /** Not always present on all parcels. */
  statutory_area?: string | null;
}

export interface LINZFeature {
  type: "Feature";
  id: string;
  geometry: LINZGeometry;
  properties: LINZParcelProperties;
}

export interface LINZFeatureCollection {
  type: "FeatureCollection";
  totalFeatures: number;
  numberMatched: number;
  numberReturned: number;
  features: LINZFeature[];
}

// ─── Connector Output Types ───────────────────────────────────────────────────

/**
 * Cleaned result returned to TerraAI consumers.
 * Only the fields required for pre-diligence are surfaced.
 */
export interface ParcelResult {
  /** LINZ internal parcel ID */
  parcel_id: number;
  /** Human-readable appellation, e.g. "Lot 1 DP 123456" */
  appellation: string | null;
  /**
   * The statutory area the parcel falls within, e.g. a reserve or heritage
   * area. Null if no statutory overlay applies.
   */
  statutory_area: string | null;
  /**
   * Intended use of the parcel as recorded by LINZ, e.g. "Fee Simple Title",
   * "Road", "Hydro", "Marginal Strip".
   */
  parcel_intent: string | null;
  /** Land district, e.g. "North Auckland" */
  land_district: string | null;
  /** Calculated area in m² */
  calc_area_m2: number | null;
  /** Raw GeoJSON geometry for downstream intersection checks */
  geometry: LINZGeometry;
}

/** Represents a failure to retrieve parcel data. */
export interface ParcelError {
  code: "NOT_FOUND" | "API_ERROR" | "PARSE_ERROR" | "INVALID_COORDINATE";
  message: string;
  coordinate: Coordinate;
}

export type ParcelResponse =
  | { success: true; data: ParcelResult }
  | { success: false; error: ParcelError };

/** Optional parameters for fetchParcelByCoordinate. */
export interface FetchParcelOptions {
  /**
   * BBOX search half-width in decimal degrees.
   * Defaults to DEFAULT_BBOX_SEARCH_RADIUS_DEGREES (~300 m at NZ latitudes).
   */
  searchRadiusDegrees?: number;
  /**
   * When set, the feature whose properties.id equals this value is chosen
   * over the area-based fallback. Use when the LINZ parcel ID is known in
   * advance (e.g. from a prior diagnostic or address look-up).
   */
  preferredParcelId?: number;
  /**
   * When set, the feature whose appellation contains this string
   * (case-insensitive) is preferred over pure area-based selection.
   */
  preferredAppellation?: string;
}

// ─── LINZ Connector ───────────────────────────────────────────────────────────

const LINZ_WFS_BASE = "https://data.linz.govt.nz/services";
const LAYER_ID = "50772";

/**
 * Half-width in decimal degrees for the BBOX search centred on a coordinate.
 * 0.003° ≈ 300 m at Auckland latitudes — wide enough to locate a titled parcel
 * even when the source coordinate sits in a road reserve or footpath.
 */
const DEFAULT_BBOX_SEARCH_RADIUS_DEGREES = 0.003;

/**
 * Builds a WFS GetFeature URL using a BBOX CQL_FILTER centred on the supplied
 * coordinate. More robust than a POINT intersect because it succeeds even when
 * the source coordinate does not fall inside a titled parcel polygon.
 *
 * CQL BBOX argument order: (shape, minLng, minLat, maxLng, maxLat)
 * — lon-first, matching LINZ WFS EPSG:4326 expectations for spatial extents.
 */
function buildBBoxSearchUrl(
  apiKey: string,
  coordinate: Coordinate,
  radiusDegrees: number
): string {
  const { lng, lat } = coordinate;
  const minLng = (lng - radiusDegrees).toFixed(7);
  const maxLng = (lng + radiusDegrees).toFixed(7);
  const minLat = (lat - radiusDegrees).toFixed(7);
  const maxLat = (lat + radiusDegrees).toFixed(7);

  // CQL BBOX — lon-first (minLng, minLat, maxLng, maxLat, SRS).
  // LINZ WFS requires the explicit EPSG:4326 qualifier; omitting it returns empty results.
  const cqlFilter = `BBOX(shape,${minLng},${minLat},${maxLng},${maxLat},'EPSG:4326')`;

  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: `layer-${LAYER_ID}`,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    CQL_FILTER: cqlFilter,
  });

  return `${LINZ_WFS_BASE};key=${encodeURIComponent(apiKey)}/wfs?${params.toString()}`;
}

/**
 * Selects the single best parcel from a BBOX result set.
 *
 * Priority order:
 *   1. Exact LINZ parcel ID match (preferredParcelId)
 *   2. Appellation contains the supplied string (case-insensitive)
 *   3. Fee Simple Title parcel with the largest calc_area
 *   4. Any parcel with the largest calc_area (last resort)
 */
function selectBestParcel(
  features: LINZFeature[],
  preferredParcelId?: number,
  preferredAppellation?: string
): LINZFeature | null {
  if (features.length === 0) return null;

  // 1. Explicit ID match
  if (preferredParcelId !== undefined) {
    const hit = features.find((f) => f.properties.id === preferredParcelId);
    if (hit) return hit;
  }

  // 2. Appellation substring match
  if (preferredAppellation) {
    const needle = preferredAppellation.toLowerCase();
    const hit = features.find((f) =>
      f.properties.appellation?.toLowerCase().includes(needle)
    );
    if (hit) return hit;
  }

  // 3. Fee Simple Title parcel with the largest area
  const feeSimple = features.filter(
    (f) => f.properties.parcel_intent === "Fee Simple Title"
  );
  const pool = feeSimple.length > 0 ? feeSimple : features;

  return pool.reduce((best, curr) =>
    (curr.properties.calc_area ?? 0) > (best.properties.calc_area ?? 0) ? curr : best
  );
}

/**
 * Validates that a coordinate pair is plausibly within New Zealand bounds.
 */
function validateNZCoordinate(coordinate: Coordinate): boolean {
  const { lng, lat } = coordinate;
  // Approximate NZ bounding box including Chatham Islands
  return lng >= 165.0 && lng <= 178.6 && lat >= -47.5 && lat <= -34.0;
}

/**
 * Maps a raw LINZ feature to the simplified ParcelResult shape.
 */
function mapFeatureToParcelResult(feature: LINZFeature): ParcelResult {
  const p = feature.properties;
  return {
    parcel_id: p.id,
    appellation: p.appellation ?? null,
    statutory_area: p.statutory_area ?? null,
    parcel_intent: p.parcel_intent ?? null,
    land_district: p.land_district ?? null,
    calc_area_m2: p.calc_area ?? null,
    geometry: feature.geometry,
  };
}

/**
 * Fetches the LINZ Primary Parcel (Layer 50772) nearest to the given
 * coordinate using a BBOX CQL_FILTER and returns its area and geometry.
 *
 * A BBOX search is used instead of a POINT intersect because input coordinates
 * often sit on road reserves or footpaths rather than inside a titled parcel
 * polygon. The BBOX is derived by expanding the coordinate by `searchRadiusDegrees`
 * in all four directions (default: 0.003°, ~300 m at Auckland latitudes).
 *
 * When multiple parcels fall inside the search box the best match is chosen:
 *   1. `preferredParcelId` exact match
 *   2. `preferredAppellation` substring match
 *   3. Fee Simple Title parcel with the largest calc_area
 *   4. Any parcel with the largest calc_area
 *
 * @param apiKey     - Your LINZ Data Service API key.
 * @param coordinate - WGS-84 coordinate pair { lng, lat }.
 * @param options    - Optional tuning parameters (see FetchParcelOptions).
 */
export async function fetchParcelByCoordinate(
  apiKey: string,
  coordinate: Coordinate,
  options?: FetchParcelOptions
): Promise<ParcelResponse> {
  if (!validateNZCoordinate(coordinate)) {
    return {
      success: false,
      error: {
        code: "INVALID_COORDINATE",
        message: `Coordinate (${coordinate.lng}, ${coordinate.lat}) is outside New Zealand bounds.`,
        coordinate,
      },
    };
  }

  const radiusDegrees =
    options?.searchRadiusDegrees ?? DEFAULT_BBOX_SEARCH_RADIUS_DEGREES;
  const url = buildBBoxSearchUrl(apiKey, coordinate, radiusDegrees);

  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (networkError) {
    return {
      success: false,
      error: {
        code: "API_ERROR",
        message: `Network error contacting LINZ WFS: ${String(networkError)}`,
        coordinate,
      },
    };
  }

  if (!response.ok) {
    return {
      success: false,
      error: {
        code: "API_ERROR",
        message: `LINZ WFS returned HTTP ${response.status}: ${response.statusText}`,
        coordinate,
      },
    };
  }

  let collection: LINZFeatureCollection;
  try {
    collection = (await response.json()) as LINZFeatureCollection;
  } catch {
    return {
      success: false,
      error: {
        code: "PARSE_ERROR",
        message: "Failed to parse LINZ WFS BBOX response as JSON.",
        coordinate,
      },
    };
  }

  if (!collection.features || collection.features.length === 0) {
    return {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `No parcel found within ${radiusDegrees}° of coordinate (${coordinate.lng}, ${coordinate.lat}).`,
        coordinate,
      },
    };
  }

  const best = selectBestParcel(
    collection.features,
    options?.preferredParcelId,
    options?.preferredAppellation
  );

  if (!best) {
    return {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `No suitable parcel found near coordinate (${coordinate.lng}, ${coordinate.lat}).`,
        coordinate,
      },
    };
  }

  return { success: true, data: mapFeatureToParcelResult(best) };
}

// ─── Bounding Box Types ───────────────────────────────────────────────────────

/**
 * Axis-aligned bounding box in WGS-84 (EPSG:4326).
 * Used to build a WFS BBOX spatial filter from a known parcel geometry.
 */
export interface BoundingBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

// ─── Bounding Box Helpers ─────────────────────────────────────────────────────

/**
 * Derives the minimum bounding box from a LINZGeometry coordinate array.
 *
 * Works for both Polygon and MultiPolygon feature types by flattening all
 * rings to a single coordinate list then taking the extent.
 */
export function computeBoundingBoxFromGeometry(geometry: LINZGeometry): BoundingBox {
  const coords: number[][] = [];

  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as number[][][];
    for (const ring of rings) {
      for (const pt of ring) coords.push(pt);
    }
  } else {
    // MultiPolygon: geometry.coordinates is number[][][][]
    const polygons = geometry.coordinates as number[][][][];
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (const pt of ring) coords.push(pt);
      }
    }
  }

  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);

  return {
    minLng: Math.min(...lngs),
    minLat: Math.min(...lats),
    maxLng: Math.max(...lngs),
    maxLat: Math.max(...lats),
  };
}

/**
 * Builds the WFS GetFeature URL using a bounding-box CQL_FILTER derived from
 * the supplied parcel geometry coordinates.
 *
 * LINZ WFS uses lon/lat ordering (following their POINT filter convention).
 * count is deliberately unset here — a bbox query may return multiple parcels
 * (e.g. subdivided lots sharing a boundary); callers should handle all features.
 */
function buildBBoxWFSUrl(apiKey: string, bbox: BoundingBox): string {
  const { minLng, minLat, maxLng, maxLat } = bbox;

  // CQL BBOX: BBOX(geometry_column, minX, minY, maxX, maxY, 'SRS')
  // LINZ WFS uses lon as X and lat as Y in EPSG:4326 context.
  const cqlFilter = `BBOX(shape,${minLng},${minLat},${maxLng},${maxLat},'EPSG:4326')`;

  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: `layer-${LAYER_ID}`,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    CQL_FILTER: cqlFilter,
  });

  return `${LINZ_WFS_BASE};key=${encodeURIComponent(apiKey)}/wfs?${params.toString()}`;
}

// ─── Geometry-based Parcel Fetcher ────────────────────────────────────────────

/**
 * Fetches LINZ Primary Parcels (Layer 50772) that fall within the bounding
 * box of the supplied parcel geometry.
 *
 * Use this after an initial address-based lookup to resolve the full parcel
 * set using the returned coordinate geometry, replacing any hardcoded extents.
 * When the result contains more than one feature, the best match is selected
 * by largest calc_area to handle parcels that share a boundary vertex.
 *
 * @param apiKey   - Your LINZ Data Service API key.
 * @param geometry - LINZGeometry returned by a prior fetchParcelByCoordinate call.
 */
export async function fetchParcelByGeometry(
  apiKey: string,
  geometry: LINZGeometry
): Promise<ParcelResponse> {
  const bbox = computeBoundingBoxFromGeometry(geometry);

  // Sanity-check: derived bbox must still be within NZ bounds.
  if (
    !validateNZCoordinate({ lng: bbox.minLng, lat: bbox.minLat }) ||
    !validateNZCoordinate({ lng: bbox.maxLng, lat: bbox.maxLat })
  ) {
    return {
      success: false,
      error: {
        code: "INVALID_COORDINATE",
        message: "Derived bounding box falls outside New Zealand bounds.",
        coordinate: { lng: (bbox.minLng + bbox.maxLng) / 2, lat: (bbox.minLat + bbox.maxLat) / 2 },
      },
    };
  }

  const url = buildBBoxWFSUrl(apiKey, bbox);

  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (networkError) {
    return {
      success: false,
      error: {
        code: "API_ERROR",
        message: `Network error contacting LINZ WFS (bbox query): ${String(networkError)}`,
        coordinate: { lng: (bbox.minLng + bbox.maxLng) / 2, lat: (bbox.minLat + bbox.maxLat) / 2 },
      },
    };
  }

  if (!response.ok) {
    return {
      success: false,
      error: {
        code: "API_ERROR",
        message: `LINZ WFS returned HTTP ${response.status}: ${response.statusText}`,
        coordinate: { lng: (bbox.minLng + bbox.maxLng) / 2, lat: (bbox.minLat + bbox.maxLat) / 2 },
      },
    };
  }

  let collection: LINZFeatureCollection;
  try {
    collection = (await response.json()) as LINZFeatureCollection;
  } catch {
    return {
      success: false,
      error: {
        code: "PARSE_ERROR",
        message: "Failed to parse LINZ WFS bbox response as JSON.",
        coordinate: { lng: (bbox.minLng + bbox.maxLng) / 2, lat: (bbox.minLat + bbox.maxLat) / 2 },
      },
    };
  }

  if (!collection.features || collection.features.length === 0) {
    return {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "No parcels found within the derived bounding box.",
        coordinate: { lng: (bbox.minLng + bbox.maxLng) / 2, lat: (bbox.minLat + bbox.maxLat) / 2 },
      },
    };
  }

  // When multiple parcels are returned, prefer the one with the largest
  // recorded area (most likely the subject parcel rather than a road reserve).
  const best = collection.features.reduce((prev, curr) =>
    (curr.properties.calc_area ?? 0) > (prev.properties.calc_area ?? 0) ? curr : prev
  );

  return { success: true, data: mapFeatureToParcelResult(best) };
}

// ─── AuditVerdict (partial — see valuation-engine.ts for full assembly) ───────

/**
 * The LINZ section of an AuditVerdict.
 * Combined with InfrastructureReport and ValuationResult in valuation-engine.ts.
 */
export interface LINZAuditSlice {
  parcel: ParcelResult | null;
  error: ParcelError | null;
}
