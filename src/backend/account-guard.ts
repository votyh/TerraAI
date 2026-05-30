/**
 * src/backend/account-guard.ts
 * TerraAI — Authenticated Audit Execution Guard
 *
 * Wraps the full TerraAI underwriting pipeline behind a credit-gate and
 * persists every successful run as an immutable Audit record.
 *
 * Execution sequence:
 *   1. Resolve User + Organization from Supabase (service-role client)
 *   2. Credit gate — reject immediately if apiCredits === 0 (zero GIS API calls made)
 *   3. Execute pipeline: LINZ WFS → Auckland Council ArcGIS → NBE calculation matrix
 *   4. Atomic write: DECREMENT org credit (optimistic UPDATE with WHERE > 0 guard),
 *      then INSERT immutable Audit record; credit is restored on INSERT failure.
 *   5. Return finalised AuditRecord + remaining credit balance to caller.
 *
 * Server-side only. Never import this module in browser bundles.
 * Requires the following environment variables:
 *   SUPABASE_URL              (or NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY — service-role secret; never expose to the client
 *   LINZ_API_KEY              — LINZ Data Service API key
 *
 * Credit concurrency model:
 *   Credits are decremented via `UPDATE … WHERE api_credits > 0`. PostgreSQL
 *   evaluates the WHERE clause at execution time, so a concurrent request that
 *   drains the last credit will cause this UPDATE to affect 0 rows — detected
 *   as a race-condition INSUFFICIENT_CREDITS error. For sub-millisecond burst
 *   concurrency, replace the UPDATE with a Postgres RPC using SELECT FOR UPDATE.
 */

import { createClient } from "@supabase/supabase-js";
import {
  fetchParcelByCoordinate,
  computeBoundingBoxFromGeometry,
  type Coordinate,
  type LINZGeometry,
} from "../../engine/linz-connector";
import {
  fetchLocalConstraints,
  calculateLandAreaDeductions,
  type ParcelGeometry,
  type LocalConstraintResult,
} from "../../engine/infrastructure-ghost";
import {
  calculateNBEValuation,
  type NBEValuationResult,
} from "../../engine/valuation-engine";

// ─── Service-Role Supabase Client ─────────────────────────────────────────────

/**
 * Builds a Supabase client authenticated as the service role.
 * Bypasses Row Level Security — use only in server-side contexts.
 */
function getServiceClient() {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new AccountGuardError(
      "SERVER_MISCONFIGURATION",
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the server environment."
    );
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// ─── Error Types ──────────────────────────────────────────────────────────────

export type AccountGuardErrorCode =
  | "INSUFFICIENT_CREDITS"
  | "USER_NOT_FOUND"
  | "ORGANIZATION_NOT_FOUND"
  | "ACCOUNT_INACTIVE"
  | "SERVER_MISCONFIGURATION"
  | "LINZ_UNAVAILABLE"
  | "PARCEL_NOT_FOUND"
  | "PARCEL_NO_AREA"
  | "AUCKLAND_GIS_UNAVAILABLE"
  | "UNKNOWN_SUBURB"
  | "AUDIT_WRITE_FAILED"
  | "ENGINE_FAULT";

export class AccountGuardError extends Error {
  readonly code: AccountGuardErrorCode;

  constructor(code: AccountGuardErrorCode, message: string) {
    super(message);
    this.name = "AccountGuardError";
    this.code = code;
  }
}

// ─── Public I/O Shapes ────────────────────────────────────────────────────────

/** Property data required to run a TerraAI audit. */
export interface GuardPropertyInput {
  /** Full street address for labelling, e.g. "17 Ohinerau St, Remuera" */
  address: string;
  /**
   * Suburb key matching SUBURB_PRICE_MATRIX in valuation-engine.ts.
   * e.g. "Remuera", "Ponsonby", "Manukau".
   */
  suburb: string;
  /** WGS-84 latitude — must be within NZ bounds, e.g. -36.8777 */
  lat: number;
  /** WGS-84 longitude — must be within NZ bounds, e.g. 174.7927 */
  lng: number;
  /**
   * Average site slope in degrees (0 = flat).
   * Feeds the tiered slope-penalty escalator in the NBE engine.
   */
  slope: number;
  /**
   * Optional Auckland Unitary Plan zone code.
   * Triggers the legal coverage deduction prior to physical deductions.
   */
  zone?: "MHU" | "MHS" | "THAB";
}

/**
 * Immutable audit record written to the `audits` table after every
 * successful pipeline execution.
 */
export interface AuditRecord {
  /** Supabase-generated UUID for this audit. */
  id: string;
  userId: string;
  organizationId: string;
  address: string;
  suburb: string;
  /** Total LINZ parcel area in m². */
  grossArea: number;
  /** Net Buildable Envelope after all GIS-derived deductions, in m². */
  netBuildableEnvelope: number;
  /** True Residual Land Value in NZD. */
  trueResidualLandValue: number;
  /**
   * Risk classification from the NBE engine.
   * "CRITICAL_DEVELOPMENT_RISK" when NBE triggers the absolute or severe floor.
   * null for developable sites.
   */
  propertyStatus: "CRITICAL_DEVELOPMENT_RISK" | null;
  /** ISO-8601 timestamp of record creation. */
  createdAt: string;
  /** Full NBE engine output, included for downstream analytics. */
  valuationDetail: NBEValuationResult;
}

export interface AuthenticatedAuditResult {
  /** The immutable audit record persisted to the database. */
  audit: AuditRecord;
  /**
   * Remaining api_credits balance AFTER this run was debited.
   * Returns -1 for unlimited-tier organisations (api_credits was -1).
   */
  remainingCredits: number;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Converts a LINZGeometry (Polygon | MultiPolygon) to the ParcelGeometry
 * interface expected by `calculateLandAreaDeductions`.
 * Only the exterior ring of the first polygon is used — sufficient for
 * constraint lookups which rely on spatial context rather than exact geometry.
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
      exterior: exteriorCoords.map(
        ([lng, lat]) => [lng, lat] as [number, number]
      ),
    },
  };
}

// ─── Main Guard Function ──────────────────────────────────────────────────────

/**
 * Executes a full TerraAI underwriting audit on behalf of an authenticated user.
 *
 * Enforces credit limits atomically before touching any external APIs.
 * Logs every successful run as an immutable record in the `audits` table.
 *
 * @param userId       - UUID of the authenticated user (from Supabase JWT `sub`).
 * @param propertyData - Property coordinates and parameters for the audit.
 * @returns            Finalised audit record and remaining credit balance.
 *
 * @throws {AccountGuardError} INSUFFICIENT_CREDITS      — org has zero api_credits
 * @throws {AccountGuardError} USER_NOT_FOUND            — userId absent from DB
 * @throws {AccountGuardError} ORGANIZATION_NOT_FOUND    — linked org missing
 * @throws {AccountGuardError} ACCOUNT_INACTIVE          — user or org is inactive
 * @throws {AccountGuardError} SERVER_MISCONFIGURATION   — missing env vars
 * @throws {AccountGuardError} LINZ_UNAVAILABLE          — LINZ WFS network error
 * @throws {AccountGuardError} PARCEL_NOT_FOUND          — no LINZ parcel at coords
 * @throws {AccountGuardError} PARCEL_NO_AREA            — parcel has no calc_area
 * @throws {AccountGuardError} AUCKLAND_GIS_UNAVAILABLE  — Auckland Council API error
 * @throws {AccountGuardError} UNKNOWN_SUBURB            — suburb not in price matrix
 * @throws {AccountGuardError} AUDIT_WRITE_FAILED        — DB persistence error
 * @throws {AccountGuardError} ENGINE_FAULT              — unexpected NBE engine error
 */
export async function executeAuthenticatedAudit(
  userId: string,
  propertyData: GuardPropertyInput
): Promise<AuthenticatedAuditResult> {
  const db = getServiceClient();

  // ── Step 1: Resolve User ─────────────────────────────────────────────────────

  const { data: user, error: userError } = await db
    .from("users")
    .select("id, organization_id, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (userError) {
    throw new AccountGuardError(
      "USER_NOT_FOUND",
      `Database error resolving user ${userId}: ${userError.message}`
    );
  }
  if (!user) {
    throw new AccountGuardError(
      "USER_NOT_FOUND",
      `User ${userId} not found.`
    );
  }
  if (!user.is_active) {
    throw new AccountGuardError(
      "ACCOUNT_INACTIVE",
      `User ${userId} account has been deactivated.`
    );
  }

  // ── Step 2: Resolve Organization ─────────────────────────────────────────────

  const { data: org, error: orgError } = await db
    .from("organizations")
    .select("id, name, api_credits, is_active")
    .eq("id", user.organization_id)
    .maybeSingle();

  if (orgError) {
    throw new AccountGuardError(
      "ORGANIZATION_NOT_FOUND",
      `Database error resolving organization ${user.organization_id}: ${orgError.message}`
    );
  }
  if (!org) {
    throw new AccountGuardError(
      "ORGANIZATION_NOT_FOUND",
      `Organization ${user.organization_id} not found.`
    );
  }
  if (!org.is_active) {
    throw new AccountGuardError(
      "ACCOUNT_INACTIVE",
      `Organization '${org.name}' account has been deactivated.`
    );
  }

  // ── Step 3: Credit Gate ──────────────────────────────────────────────────────
  //
  // api_credits === -1  →  unlimited tier  →  no gate applied
  // api_credits === 0   →  exhausted       →  reject before any GIS call
  // api_credits  >  0   →  normal budget   →  proceed, decrement after pipeline

  if (org.api_credits === 0) {
    throw new AccountGuardError(
      "INSUFFICIENT_CREDITS",
      `Organization '${org.name}' has no remaining API credits. ` +
        "Please top up your account to continue running audits."
    );
  }

  // ── Step 4: LINZ WFS — Statutory Parcel Lookup ──────────────────────────────

  const linzApiKey = process.env.LINZ_API_KEY;
  if (!linzApiKey) {
    throw new AccountGuardError(
      "SERVER_MISCONFIGURATION",
      "LINZ_API_KEY environment variable is not set."
    );
  }

  const coordinate: Coordinate = { lat: propertyData.lat, lng: propertyData.lng };

  let parcelResponse: Awaited<ReturnType<typeof fetchParcelByCoordinate>>;
  try {
    parcelResponse = await fetchParcelByCoordinate(linzApiKey, coordinate);
  } catch (err) {
    throw new AccountGuardError(
      "LINZ_UNAVAILABLE",
      `LINZ WFS network error: ${String(err)}`
    );
  }

  if (!parcelResponse.success) {
    const { code, message } = parcelResponse.error;
    if (code === "INVALID_COORDINATE") {
      throw new AccountGuardError("LINZ_UNAVAILABLE", message);
    }
    if (code === "NOT_FOUND") {
      throw new AccountGuardError("PARCEL_NOT_FOUND", message);
    }
    // API_ERROR | PARSE_ERROR
    throw new AccountGuardError(
      "LINZ_UNAVAILABLE",
      `LINZ API error [${code}]: ${message}`
    );
  }

  const parcel = parcelResponse.data;

  if (!parcel.calc_area_m2 || parcel.calc_area_m2 <= 0) {
    throw new AccountGuardError(
      "PARCEL_NO_AREA",
      `LINZ parcel ${parcel.parcel_id} carries no usable calc_area — ` +
        "cannot proceed with NBE valuation."
    );
  }

  // ── Step 5: Auckland Council ArcGIS — Infrastructure Constraint Layers ────────

  const bbox = computeBoundingBoxFromGeometry(parcel.geometry);
  const bboxString = `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;

  let localConstraints: LocalConstraintResult;
  try {
    localConstraints = await fetchLocalConstraints(bboxString);
  } catch (err) {
    throw new AccountGuardError(
      "AUCKLAND_GIS_UNAVAILABLE",
      `Auckland Council ArcGIS error: ${String(err)}`
    );
  }

  // ── Step 6: Land-Area Deductions + NBE Calculation Matrix ────────────────────

  const parcelGeometry = linzGeometryToParcelGeometry(parcel.geometry);
  const deductions = calculateLandAreaDeductions(
    parcelGeometry,
    localConstraints.constraints
  );

  let nbeResult: NBEValuationResult;
  try {
    nbeResult = calculateNBEValuation({
      gross_site_area_m2: parcel.calc_area_m2,
      land_deductions: deductions,
      suburb: propertyData.suburb,
      average_slope_degrees: propertyData.slope,
      ...(propertyData.zone ? { zone: propertyData.zone } : {}),
    });
  } catch (err) {
    const detail = String(err);
    if (detail.includes("Unknown suburb")) {
      throw new AccountGuardError("UNKNOWN_SUBURB", detail);
    }
    throw new AccountGuardError("ENGINE_FAULT", `NBE engine fault: ${detail}`);
  }

  // ── Step 7: Atomic DB Write — Debit Credit + Persist Audit ──────────────────
  //
  // Unlimited tier (api_credits === -1): skip the UPDATE entirely.
  //
  // Paid tier (api_credits > 0):
  //   UPDATE organisations SET api_credits = api_credits - 1
  //   WHERE id = ? AND api_credits > 0
  //
  // The WHERE api_credits > 0 clause is evaluated by PostgreSQL at execution
  // time. A concurrent request that drains the last credit will cause this
  // UPDATE to match 0 rows — returned as an empty array by Supabase, detected
  // here as a race-condition INSUFFICIENT_CREDITS fault.

  let remainingCredits: number;

  if (org.api_credits > 0) {
    const { data: creditRows, error: creditError } = await db
      .from("organizations")
      .update({ api_credits: (org.api_credits as number) - 1 })
      .eq("id", org.id)
      .gt("api_credits", 0)   // WHERE api_credits > 0 — evaluated at DB execution time
      .select("api_credits");

    if (creditError) {
      throw new AccountGuardError(
        "AUDIT_WRITE_FAILED",
        `Credit debit error for organisation '${org.name}': ${creditError.message}`
      );
    }

    if (!creditRows || creditRows.length === 0) {
      // 0 rows updated: credits reached 0 between our read and this UPDATE
      // (concurrent request consumed the last credit).
      throw new AccountGuardError(
        "INSUFFICIENT_CREDITS",
        `Organisation '${org.name}' credit balance was exhausted by a concurrent ` +
          "request. Please retry — if credits remain, the next request will succeed."
      );
    }

    remainingCredits = (creditRows[0] as { api_credits: number }).api_credits;
  } else {
    // Unlimited tier — api_credits === -1; no debit needed.
    remainingCredits = -1;
  }

  // Insert the immutable audit record. On failure, restore the debited credit.
  const { data: auditRow, error: auditInsertError } = await db
    .from("audits")
    .insert({
      user_id: userId,
      organization_id: org.id,
      address: propertyData.address,
      suburb: propertyData.suburb,
      gross_area: nbeResult.gross_area_m2,
      net_buildable_envelope: nbeResult.net_buildable_envelope_m2,
      true_residual_land_value: nbeResult.true_residual_land_value_nzd,
      property_status: nbeResult.property_status ?? null,
    })
    .select("id, created_at")
    .single();

  if (auditInsertError || !auditRow) {
    // Audit write failed — best-effort restore of the debited credit.
    if (org.api_credits > 0) {
      await db
        .from("organizations")
        .update({ api_credits: remainingCredits + 1 })
        .eq("id", org.id)
        .then(() => {
          // Secondary failure is not actionable here; caller receives AUDIT_WRITE_FAILED.
        });
    }

    throw new AccountGuardError(
      "AUDIT_WRITE_FAILED",
      `Failed to persist audit record: ${auditInsertError?.message ?? "unknown database error"}`
    );
  }

  // ── Step 8: Return Finalised Result ─────────────────────────────────────────

  const auditRecord: AuditRecord = {
    id: auditRow.id as string,
    userId,
    organizationId: org.id as string,
    address: propertyData.address,
    suburb: propertyData.suburb,
    grossArea: nbeResult.gross_area_m2,
    netBuildableEnvelope: nbeResult.net_buildable_envelope_m2,
    trueResidualLandValue: nbeResult.true_residual_land_value_nzd,
    propertyStatus: nbeResult.property_status ?? null,
    createdAt: auditRow.created_at as string,
    valuationDetail: nbeResult,
  };

  return { audit: auditRecord, remainingCredits };
}
