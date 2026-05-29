/**
 * src/app/api/audit/route.ts
 * TerraAI — Asset Audit Engine — App Router POST handler.
 *
 * Pipeline:
 *   1. Parse & validate request body (address, suburb, slope, lat, lng)
 *   2. LINZ WFS — fetch the statutory parcel at the supplied coordinate
 *   3. Auckland Council ArcGIS — resolve live stormwater / flow-path constraints
 *   4. Calculate land-area deductions from resolved constraint flags
 *   5. Run the NBE underwriting engine (calculateNBEValuation)
 *   6. Return institutional telemetry JSON
 *
 * Environment:
 *   LINZ_API_KEY — required. Next.js App Router natively loads .env / .env.local,
 *   so no dotenv/config import is needed here.
 */

import { NextRequest, NextResponse } from "next/server";

// Engine imports — paths resolve from src/app/api/audit/ → ../../../../engine/
import {
  fetchParcelByCoordinate,           // user-facing name: fetchParcelGeometry
  computeBoundingBoxFromGeometry,
  type Coordinate,
  type LINZGeometry,
} from "../../../../engine/linz-connector";

import {
  fetchLocalConstraints,
  calculateLandAreaDeductions,
  type ParcelGeometry,
  type LocalConstraintResult,
} from "../../../../engine/infrastructure-ghost";

import {
  calculateNBEValuation,             // user-facing name: underwriteSiteValue
  type NBEValuationResult,
} from "../../../../engine/valuation-engine";

// ─── Runtime ──────────────────────────────────────────────────────────────────

/**
 * Pin to the Node.js runtime. The engine modules use native fetch,
 * URLSearchParams, and Math APIs that require Node.js globals — not the
 * constrained Edge Runtime environment.
 */
export const runtime = "nodejs";

// ─── Diagnostic Error Codes ───────────────────────────────────────────────────

const DIAG = {
  /** One or more required request body fields are absent or the wrong type. */
  MISSING_FIELDS: "AUDIT_MISSING_REQUIRED_FIELDS",
  /** Supplied coordinate is outside the New Zealand bounding box. */
  INVALID_COORDINATE: "AUDIT_INVALID_COORDINATE",
  /** LINZ WFS system returned a network error or non-2xx status. */
  LINZ_GIS_UNAVAILABLE: "LINZ_GIS_SYSTEM_UNAVAILABLE",
  /** LINZ returned zero matching parcels for the supplied coordinate. */
  PARCEL_NOT_FOUND: "LINZ_PARCEL_NOT_FOUND",
  /** LINZ parcel exists but carries no usable calc_area value. */
  PARCEL_NO_AREA: "LINZ_PARCEL_MISSING_AREA_DATA",
  /** Auckland Council ArcGIS FeatureServer returned a network/HTTP error. */
  AUCKLAND_GIS_UNAVAILABLE: "AUCKLAND_GIS_SYSTEM_UNAVAILABLE",
  /** Supplied suburb is not present in the valuation engine's price matrix. */
  UNKNOWN_SUBURB: "VALUATION_UNKNOWN_SUBURB",
  /** Unexpected internal engine fault not attributable to a third-party system. */
  ENGINE_FAULT: "TERRAAI_INTERNAL_ENGINE_FAULT",
} as const;

type DiagCode = (typeof DIAG)[keyof typeof DIAG];

// ─── Request Body Shape ───────────────────────────────────────────────────────

interface AuditRequestBody {
  /** Full street address for labelling, e.g. "12 Ponsonby Road, Auckland". */
  address: string;
  /**
   * Suburb name that maps into SUBURB_PRICE_MATRIX, e.g. "Remuera".
   * Must be an exact key match (case-sensitive).
   */
  suburb: string;
  /** Average site slope in degrees (0 = flat). Drives tiered slope penalty. */
  slope: number;
  /** WGS-84 latitude, e.g. -36.8777. Must be within NZ bounds. */
  lat: number;
  /** WGS-84 longitude, e.g. 174.7927. Must be within NZ bounds. */
  lng: number;
}

// ─── Response Shape ───────────────────────────────────────────────────────────

interface AuditTelemetry {
  /** Total parcel area from LINZ calc_area (m²). */
  grossArea: number;
  /** Net Buildable Envelope after all GIS-derived deductions (m²). */
  netBuildableEnvelope: number;
  /** NBE × base land value per m² — before slope penalty (NZD). */
  baseLandValue: number;
  /** Monetary deduction for topographical slope (NZD). */
  topographicalPenalty: number;
  /** True Residual Land Value: baseLandValue − topographicalPenalty (NZD). */
  trueResidualLandValue: number;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Builds a NextResponse error envelope with a machine-readable diagnostic code.
 */
function errorResponse(
  code: DiagCode,
  message: string,
  status: number
): NextResponse {
  return NextResponse.json(
    { success: false as const, diagnostic_code: code, message },
    { status }
  );
}

/**
 * Converts a LINZGeometry (Polygon | MultiPolygon) to the ParcelGeometry
 * interface required by `calculateLandAreaDeductions`.
 *
 * Only the exterior ring of the first polygon is extracted.
 * `calculateLandAreaDeductions` currently uses the geometry purely for spatial
 * context (void parcelGeometry) so a single exterior ring is sufficient.
 */
function linzGeometryToParcelGeometry(geometry: LINZGeometry): ParcelGeometry {
  let exteriorCoords: number[][];

  if (geometry.type === "Polygon") {
    exteriorCoords = (geometry.coordinates as number[][][])[0];
  } else {
    // MultiPolygon — use the exterior ring of the first (largest) polygon.
    exteriorCoords = (geometry.coordinates as number[][][][])[0][0];
  }

  return {
    parcel_boundary: {
      exterior: exteriorCoords.map(([lng, lat]) => [lng, lat] as [number, number]),
    },
  };
}

// ─── POST /api/audit ──────────────────────────────────────────────────────────

/**
 * Runs the full TerraAI asset audit pipeline for a single property coordinate.
 *
 * Request body (JSON):
 * ```json
 * {
 *   "address": "12 Ponsonby Road",
 *   "suburb":  "Ponsonby",
 *   "slope":   8,
 *   "lat":    -36.8485,
 *   "lng":    174.7633
 * }
 * ```
 *
 * Success response (200):
 * ```json
 * {
 *   "success": true,
 *   "property_address": "...",
 *   "parcel": { ... },
 *   "telemetry": {
 *     "grossArea": 702,
 *     "netBuildableEnvelope": 528,
 *     "baseLandValue": 2904000,
 *     "topographicalPenalty": 0,
 *     "trueResidualLandValue": 2904000
 *   },
 *   "valuation": { ... },
 *   "constraints": { ... }
 * }
 * ```
 *
 * Error responses carry `{ success: false, diagnostic_code, message }`.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {

  // ── Step 1: Parse & validate body ─────────────────────────────────────────

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse(
      DIAG.MISSING_FIELDS,
      "Request body is not valid JSON.",
      400
    );
  }

  const body = rawBody as Partial<AuditRequestBody>;

  if (
    typeof body.address !== "string" || body.address.trim() === "" ||
    typeof body.suburb  !== "string" || body.suburb.trim()  === "" ||
    typeof body.slope   !== "number" || !Number.isFinite(body.slope) ||
    typeof body.lat     !== "number" || !Number.isFinite(body.lat)   ||
    typeof body.lng     !== "number" || !Number.isFinite(body.lng)
  ) {
    return errorResponse(
      DIAG.MISSING_FIELDS,
      "Required fields: address (string), suburb (string), slope (number), " +
      "lat (number), lng (number). All must be present and finite.",
      400
    );
  }

  const address  = body.address.trim();
  const suburb   = body.suburb.trim();
  const slope    = body.slope;
  const coordinate: Coordinate = { lng: body.lng, lat: body.lat };

  console.log("[API] Incoming payload received:", body);

  // ── Step 2: Resolve LINZ_API_KEY ──────────────────────────────────────────

  const linzApiKey = process.env.LINZ_API_KEY;
  if (!linzApiKey) {
    return errorResponse(
      DIAG.ENGINE_FAULT,
      "Server misconfiguration: LINZ_API_KEY is not set in the environment.",
      500
    );
  }

  // ── Step 3: LINZ WFS — statutory parcel lookup ────────────────────────────

  console.log("[API] Launching LINZ cadastral fetch...");
  let parcelResponse: Awaited<ReturnType<typeof fetchParcelByCoordinate>>;
  try {
    parcelResponse = await fetchParcelByCoordinate(linzApiKey, coordinate);
  } catch (err) {
    return errorResponse(
      DIAG.LINZ_GIS_UNAVAILABLE,
      `LINZ WFS system is unavailable or timed out. Detail: ${String(err)}`,
      503
    );
  }

  if (!parcelResponse.success) {
    const { code, message } = parcelResponse.error;

    if (code === "INVALID_COORDINATE") {
      return errorResponse(DIAG.INVALID_COORDINATE, message, 400);
    }
    if (code === "NOT_FOUND") {
      return errorResponse(
        DIAG.PARCEL_NOT_FOUND,
        `No LINZ parcel found near (${coordinate.lng}, ${coordinate.lat}). ${message}`,
        404
      );
    }
    // API_ERROR | PARSE_ERROR
    return errorResponse(
      DIAG.LINZ_GIS_UNAVAILABLE,
      `LINZ API error [${code}]: ${message}`,
      503
    );
  }

  const parcel = parcelResponse.data;

  if (!parcel.calc_area_m2 || parcel.calc_area_m2 <= 0) {
    return errorResponse(
      DIAG.PARCEL_NO_AREA,
      `LINZ parcel ${parcel.parcel_id} carries no usable calc_area. ` +
      "Cannot proceed with NBE valuation.",
      422
    );
  }

  // ── Step 4: Auckland Council ArcGIS — live constraint lookup ──────────────

  console.log("[API] Launching Auckland Council asset infrastructure fetch...");
  const bbox = computeBoundingBoxFromGeometry(parcel.geometry);
  const bboxString =
    `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;

  let localConstraints: LocalConstraintResult;
  try {
    localConstraints = await fetchLocalConstraints(bboxString);
  } catch (err) {
    return errorResponse(
      DIAG.AUCKLAND_GIS_UNAVAILABLE,
      `Auckland Council ArcGIS system is unavailable or timed out. Detail: ${String(err)}`,
      503
    );
  }

  // ── Step 5: Land-area deductions from resolved constraint flags ────────────

  const parcelGeometry: ParcelGeometry = linzGeometryToParcelGeometry(
    parcel.geometry
  );
  const deductions = calculateLandAreaDeductions(
    parcelGeometry,
    localConstraints.constraints
  );

  // ── Step 6: NBE underwriting engine ───────────────────────────────────────

  console.log("[API] Passing GIS results into calculation engine...");
  let nbeResult: NBEValuationResult;
  try {
    nbeResult = calculateNBEValuation({
      gross_site_area_m2: parcel.calc_area_m2,
      land_deductions: deductions,
      suburb,
      average_slope_degrees: slope,
    });
  } catch (err) {
    const detail = String(err);
    if (detail.includes("Unknown suburb")) {
      return errorResponse(DIAG.UNKNOWN_SUBURB, detail, 422);
    }
    return errorResponse(
      DIAG.ENGINE_FAULT,
      `NBE engine fault: ${detail}`,
      500
    );
  }

  // ── Step 7: Assemble & return institutional telemetry ─────────────────────

  console.log("[API] Success. Returning payload.");
  const telemetry: AuditTelemetry = {
    grossArea:              nbeResult.gross_area_m2,
    netBuildableEnvelope:   nbeResult.net_buildable_envelope_m2,
    baseLandValue:          nbeResult.raw_land_value_nzd,
    topographicalPenalty:   nbeResult.topographical_penalty_nzd,
    trueResidualLandValue:  nbeResult.true_residual_land_value_nzd,
  };

  return NextResponse.json(
    {
      success: true as const,

      property_address: address,

      /** LINZ statutory parcel metadata. */
      parcel: {
        parcel_id:     parcel.parcel_id,
        appellation:   parcel.appellation,
        parcel_intent: parcel.parcel_intent,
        land_district: parcel.land_district,
      },

      /** Core institutional telemetry — the five canonical output fields. */
      telemetry,

      /** Full NBE valuation detail for downstream analytics. */
      valuation: {
        suburb:                      nbeResult.suburb,
        land_base_value_per_m2_nzd:  nbeResult.land_base_value_per_m2_nzd,
        slope_penalty_rate:          nbeResult.slope_penalty_rate,
        nbe_ratio:                   nbeResult.nbe_ratio,
        ...(nbeResult.property_status !== undefined && {
          property_status:               nbeResult.property_status,
          non_developable_land_value_nzd: nbeResult.non_developable_land_value_nzd,
        }),
      },

      /** GIS-derived deductions and raw feature counts for audit logging. */
      constraints: {
        stormwater_pipe_corridor_deduction_m2: deductions.stormwater_pipe_corridor_m2,
        overland_flow_path_deduction_m2:       deductions.overland_flow_path_m2,
        total_deduction_m2:                    deductions.total_deduction_m2,
        gis_diagnostics:                       localConstraints.diagnostics,
      },
    },
    { status: 200 }
  );

  } catch (error) {
    console.error("[API] CRITICAL FAULT:", error);
    return NextResponse.json(
      {
        success: false as const,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
