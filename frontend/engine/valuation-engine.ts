/**
 * valuation-engine.ts
 * TerraAI — Residual Land Value (RLV) calculator.
 *
 * Formula:
 *   RLV = GDV − (Construction Costs + Profit Margin + Professional Fees)
 *
 * Where:
 *   GDV              = Estimated End Sale Value (Gross Development Value)
 *   Profit Margin    = 20% of GDV (standard NZ developer margin)
 *   Professional Fees = architect, engineer, planner, legal, PM etc.
 *
 * Topographical Penalty:
 *   For every 5 degrees of slope above 10°, add 15% to the base
 *   construction cost.
 *   e.g. 20° slope → 2 increments → +30% construction cost.
 *
 * All monetary values are in NZD.
 */

import type { LINZAuditSlice } from "./linz-connector";
import type { InfrastructureAuditSlice, LandAreaDeduction, RiskLevel } from "./infrastructure-ghost";
import { type AUPZoneCode, resolveZoneCoverageDeduction } from "./infrastructure-ghost";

// ─── Input Types ──────────────────────────────────────────────────────────────

/** Describes a single comparable sale used to estimate end value. */
export interface ComparableSale {
  address: string;
  sale_price_nzd: number;
  floor_area_m2: number;
  sale_date: string; // ISO 8601 date string
}

export interface TopographyData {
  /** Average slope of the site in degrees (0 = flat, 90 = vertical cliff) */
  average_slope_degrees: number;
  /**
   * Optional: maximum slope degrees on any part of the site.
   * Used for worst-case cost estimation if provided.
   */
  max_slope_degrees?: number;
}

export interface ConstructionInputs {
  /**
   * Base construction cost in NZD before any slope or infrastructure penalty.
   * Typically $/m² × total GFA.
   */
  base_construction_cost_nzd: number;
  /** Total gross floor area to be built in m² */
  gross_floor_area_m2: number;
  /** Professional fees (architect, engineer, planner, legal, PM) in NZD */
  professional_fees_nzd: number;
  /** Any additional contingency costs in NZD (default 0) */
  contingency_nzd?: number;
}

export interface ValuationInputs {
  /** Address string for labelling */
  property_address: string;
  /** Estimated End Sale Value / Gross Development Value (GDV) in NZD */
  estimated_end_sale_value_nzd: number;
  topography: TopographyData;
  construction: ConstructionInputs;
  /**
   * Additional infrastructure cost from infrastructure-ghost.ts.
   * Pass InfrastructureReport.total_estimated_cost_nzd here.
   */
  infrastructure_cost_nzd?: number;
  /** Optional comparable sales used to validate GDV estimate */
  comparables?: ComparableSale[];
}

// ─── Output Types ─────────────────────────────────────────────────────────────

export interface TopographicalPenalty {
  /** Degrees of slope above the 10° threshold */
  excess_slope_degrees: number;
  /** Number of 5-degree increments above threshold */
  penalty_increments: number;
  /** Percentage added to construction cost (e.g. 0.30 = 30%) */
  penalty_rate: number;
  /** Additional cost in NZD due to slope */
  penalty_cost_nzd: number;
}

export interface CostBreakdown {
  base_construction_nzd: number;
  topographical_penalty: TopographicalPenalty;
  adjusted_construction_nzd: number;
  infrastructure_nzd: number;
  professional_fees_nzd: number;
  contingency_nzd: number;
  /** 20% of GDV */
  developer_profit_nzd: number;
  /** Sum of all costs (excluding GDV) */
  total_deductions_nzd: number;
}

export type FeasibilityVerdict =
  | "VIABLE"          // RLV > 0 and land can be purchased profitably
  | "MARGINAL"        // RLV > 0 but thin margin
  | "UNVIABLE"        // RLV ≤ 0 — project destroys value
  | "CAUTION";        // RLV > 0 but significant risk flags reduce confidence

export interface ValuationResult {
  property_address: string;
  /** Gross Development Value supplied as input */
  gdv_nzd: number;
  cost_breakdown: CostBreakdown;
  /**
   * Residual Land Value — the maximum price a developer should pay for the land
   * after all costs and profit margin are covered.
   */
  residual_land_value_nzd: number;
  feasibility: FeasibilityVerdict;
  /** Human-readable summary of the valuation outcome */
  summary: string;
  /**
   * Comparable sales used to sense-check the GDV estimate, if supplied.
   */
  comparables_analysis?: ComparablesAnalysis;
}

export interface ComparablesAnalysis {
  average_price_per_m2_nzd: number;
  implied_gdv_nzd: number;
  gdv_variance_pct: number;
  note: string;
}

// ─── Suburb Price Matrix ──────────────────────────────────────────────────────

/**
 * Base land value (NZD per m²) keyed by suburb name.
 * Add new suburbs here as live data sources are connected.
 */
export const SUBURB_PRICE_MATRIX: Record<string, number> = {
  Remuera:   5000,
  Ponsonby:  5500,
  Manukau:   2200,
  Henderson: 2000,
};

/**
 * Resolves the base land value per m² for a given suburb.
 * Throws if the suburb is not yet in the matrix.
 */
export function resolveSuburbBaseRate(suburb: string): number {
  const rate = SUBURB_PRICE_MATRIX[suburb];
  if (rate === undefined) {
    throw new Error(
      `Unknown suburb "${suburb}". Add it to SUBURB_PRICE_MATRIX before running a valuation.`
    );
  }
  return rate;
}

// ─── Topographical Penalty Calculator ────────────────────────────────────────

const SLOPE_THRESHOLD_DEGREES = 10;
const SLOPE_INCREMENT_DEGREES = 5;
const SLOPE_PENALTY_PER_INCREMENT = 0.15; // 15% per 5° increment

/**
 * Calculates the topographical cost penalty.
 *
 * For every 5 degrees of slope above 10°, construction cost increases 15%.
 */
export function calculateTopographicalPenalty(
  baseConstructionCost: number,
  topography: TopographyData
): TopographicalPenalty {
  const slope = topography.average_slope_degrees;
  const excessSlope = Math.max(0, slope - SLOPE_THRESHOLD_DEGREES);
  const increments = Math.floor(excessSlope / SLOPE_INCREMENT_DEGREES);
  const penaltyRate = increments * SLOPE_PENALTY_PER_INCREMENT;
  const penaltyCost = baseConstructionCost * penaltyRate;

  return {
    excess_slope_degrees: excessSlope,
    penalty_increments: increments,
    penalty_rate: penaltyRate,
    penalty_cost_nzd: Math.round(penaltyCost),
  };
}

// ─── RLV Calculator ───────────────────────────────────────────────────────────

/**
 * Analyses comparable sales and validates the GDV estimate.
 */
function analyseComparables(
  gdv: number,
  gfa_m2: number,
  comparables: ComparableSale[]
): ComparablesAnalysis {
  const pricesPerM2 = comparables.map(
    (c) => c.sale_price_nzd / c.floor_area_m2
  );
  const avgPricePerM2 =
    pricesPerM2.reduce((sum, p) => sum + p, 0) / pricesPerM2.length;
  const impliedGdv = avgPricePerM2 * gfa_m2;
  const variance = ((gdv - impliedGdv) / impliedGdv) * 100;

  let note: string;
  if (Math.abs(variance) < 5) {
    note = "GDV estimate aligns closely with comparable sales data.";
  } else if (variance > 15) {
    note = `GDV estimate is ${variance.toFixed(1)}% above comparable sales — consider conservative revision.`;
  } else if (variance < -15) {
    note = `GDV estimate is ${Math.abs(variance).toFixed(1)}% below comparable sales — upside may exist.`;
  } else {
    note = `GDV estimate is within ${Math.abs(variance).toFixed(1)}% of comparable sales benchmark.`;
  }

  return {
    average_price_per_m2_nzd: Math.round(avgPricePerM2),
    implied_gdv_nzd: Math.round(impliedGdv),
    gdv_variance_pct: Math.round(variance * 10) / 10,
    note,
  };
}

function determineFeasibility(
  rlv: number,
  gdv: number,
  infraRisk: RiskLevel | null
): FeasibilityVerdict {
  const rlvRatio = rlv / gdv;

  if (rlv <= 0) return "UNVIABLE";
  if (infraRisk === "HIGH" || infraRisk === "CRITICAL") return "CAUTION";
  if (rlvRatio < 0.08) return "MARGINAL";
  return "VIABLE";
}

function buildSummary(
  feasibility: FeasibilityVerdict,
  rlv: number,
  gdv: number
): string {
  const rlvFormatted = rlv.toLocaleString("en-NZ", {
    style: "currency",
    currency: "NZD",
    maximumFractionDigits: 0,
  });
  const rlvPct = ((rlv / gdv) * 100).toFixed(1);

  switch (feasibility) {
    case "VIABLE":
      return (
        `Project is financially viable. Maximum land acquisition price is ${rlvFormatted} ` +
        `(${rlvPct}% of GDV). Strong feasibility at current cost assumptions.`
      );
    case "MARGINAL":
      return (
        `Project is marginally viable. Residual land value of ${rlvFormatted} leaves thin margin. ` +
        `Negotiate land price carefully and pressure-test construction costs.`
      );
    case "UNVIABLE":
      return (
        `Project is unviable at current cost assumptions. Residual land value is ${rlvFormatted} — ` +
        `costs exceed GDV. Redesign scope, reduce costs, or walk away.`
      );
    case "CAUTION":
      return (
        `Project shows a positive residual of ${rlvFormatted} but infrastructure risk flags ` +
        `significantly erode confidence. Obtain firm cost estimates before committing.`
      );
  }
}

/**
 * Calculates the Residual Land Value (RLV) for a development project.
 *
 * @param inputs     - Full valuation inputs
 * @param infraRisk  - Overall infrastructure risk level from infrastructure-ghost.ts (optional)
 */
export function calculateRLV(
  inputs: ValuationInputs,
  infraRisk?: RiskLevel
): ValuationResult {
  const {
    property_address,
    estimated_end_sale_value_nzd: gdv,
    topography,
    construction,
    infrastructure_cost_nzd = 0,
    comparables,
  } = inputs;

  const {
    base_construction_cost_nzd: baseCost,
    gross_floor_area_m2: gfa,
    professional_fees_nzd: professionalFees,
    contingency_nzd: contingency = 0,
  } = construction;

  // Topographical penalty applied to base construction cost
  const topopenalty = calculateTopographicalPenalty(baseCost, topography);
  const adjustedConstruction = Math.round(baseCost + topopenalty.penalty_cost_nzd);

  // Developer profit margin = 20% of GDV (standard NZ development appraisal)
  const developerProfit = Math.round(gdv * 0.2);

  const totalDeductions =
    adjustedConstruction +
    infrastructure_cost_nzd +
    professionalFees +
    contingency +
    developerProfit;

  const rlv = Math.round(gdv - totalDeductions);

  const costBreakdown: CostBreakdown = {
    base_construction_nzd: Math.round(baseCost),
    topographical_penalty: topopenalty,
    adjusted_construction_nzd: adjustedConstruction,
    infrastructure_nzd: Math.round(infrastructure_cost_nzd),
    professional_fees_nzd: Math.round(professionalFees),
    contingency_nzd: Math.round(contingency),
    developer_profit_nzd: developerProfit,
    total_deductions_nzd: Math.round(totalDeductions),
  };

  const feasibility = determineFeasibility(rlv, gdv, infraRisk ?? null);
  const summary = buildSummary(feasibility, rlv, gdv);

  const result: ValuationResult = {
    property_address,
    gdv_nzd: Math.round(gdv),
    cost_breakdown: costBreakdown,
    residual_land_value_nzd: rlv,
    feasibility,
    summary,
  };

  if (comparables && comparables.length > 0) {
    result.comparables_analysis = analyseComparables(gdv, gfa, comparables);
  }

  return result;
}

// ─── NBE Slope & Risk Constants ───────────────────────────────────────────────

/**
 * Tiered slope penalty rate for the NBE land-value model.
 *
 * Tiers (applied to the net buildable land value, not construction cost):
 *   0–5°   → 0%
 *   5–15°  → 15%
 *   15–25° → 35%
 *   >25°   → 55%
 */
export function calculateTieredSlopePenaltyRate(slope_degrees: number): number {
  if (slope_degrees <= 5)  return 0.00;
  if (slope_degrees <= 15) return 0.15;
  if (slope_degrees <= 25) return 0.35;
  return 0.55;
}

/** Minimum NBE below which the severe-floor haircut applies (m²). */
const CRITICAL_NBE_FLOOR_M2 = 150;

/**
 * Extra RLV haircut applied when NBE falls below the severe floor (150 m²)
 * but above the absolute floor. 0.40 = 40% reduction on the slope-adjusted value.
 */
const CRITICAL_NBE_SAFETY_MARGIN = 0.40;

/**
 * Absolute NBE floor in m². At or below this value — or when NBE is less than
 * ABSOLUTE_NBE_RATIO_FLOOR of the gross site area — the site is deemed
 * non-developable and the purchase price is capped at bare land value.
 */
const ABSOLUTE_NBE_FLOOR_M2 = 100;

/**
 * NBE-to-gross-area ratio below which the absolute non-developable floor fires.
 * 0.20 = 20% of gross site area.
 */
const ABSOLUTE_NBE_RATIO_FLOOR = 0.20;

/**
 * Conservative bare-land rate per m² (NZD) applied to the entire gross site
 * area when the absolute floor is triggered. Reflects residual value with
 * zero development potential.
 */
const NON_DEVELOPABLE_LAND_RATE_PER_M2_NZD = 500;

// ─── Net Buildable Envelope (NBE) Types ──────────────────────────────────────

/** Inputs for the NBE-based land underwriting model. */
export interface NBEInputs {
  /** Total site area before any deductions, in m². */
  gross_site_area_m2: number;
  /** Land area deductions derived from Auckland council constraint analysis. */
  land_deductions: LandAreaDeduction;
  /**
   * Suburb name used to look up base land value per m² from SUBURB_PRICE_MATRIX.
   * e.g. "Remuera", "Ponsonby", "Manukau".
   */
  suburb: string;
  /**
   * Average slope of the site in degrees — fed into the tiered escalator to
   * derive the slope penalty rate automatically.
   * 0 = flat, 90 = vertical cliff.
   */
  average_slope_degrees: number;
  /**
   * Optional Auckland Unitary Plan (AUP) zone code.
   * When supplied, a legal coverage deduction is applied to the gross site area
   * *before* physical infrastructure deductions, capturing the cumulative
   * legal and structural capacity limit in the Net Buildable Envelope.
   */
  zone?: AUPZoneCode;
}

/** Full NBE valuation output containing all institutional telemetry fields. */
export interface NBEValuationResult {
  /** Total parcel area before any deductions, in m². */
  gross_area_m2: number;
  /** Net Buildable Envelope: gross area minus all constraint deductions, in m². */
  net_buildable_envelope_m2: number;
  /** Suburb used for base land value lookup. */
  suburb: string;
  /** Resolved land base value per m² from SUBURB_PRICE_MATRIX (NZD). */
  land_base_value_per_m2_nzd: number;
  /** Tiered slope penalty rate derived from average_slope_degrees (e.g. 0.35 = 35%). */
  slope_penalty_rate: number;
  /** Land value of the NBE at base rate, before slope penalty (NZD). */
  raw_land_value_nzd: number;
  /**
   * Total monetary penalty deducted from NBE land value due to topographical
   * slope. Applied to the net buildable land value only, not the gross site value.
   */
  topographical_penalty_nzd: number;
  /** True Residual Land Value: NBE land value after slope penalty deduction (NZD). */
  true_residual_land_value_nzd: number;
  /** NBE expressed as a fraction of gross site area (e.g. 0.765 = 76.5%). */
  nbe_ratio: number;
  /**
   * Auckland Unitary Plan zone code applied to this valuation ("MHU" | "MHS" | "THAB").
   * Absent when no zone was supplied.
   */
  aup_zone?: AUPZoneCode;
  /**
   * Area (m²) deducted from gross site area due to the AUP zone coverage limit.
   * Applied before physical infrastructure deductions.
   * Absent when no zone was supplied.
   */
  zone_coverage_deduction_m2?: number;
  /**
   * Capped purchase price when the absolute development floor is triggered
   * (NBE < 100 m² or NBE < 20% of gross site area). Equals gross site area
   * × $500/m² (non-developable bare-land rate). Absent when the site is
   * developable and the floor does not apply.
   */
  non_developable_land_value_nzd?: number;
  /**
   * Set to "CRITICAL_DEVELOPMENT_RISK" under either of two conditions:
   *   • Absolute floor — NBE < 100 m² OR NBE < 20% of gross site area:
   *       purchase price is capped at non_developable_land_value_nzd.
   *   • Severe floor  — NBE < 150 m² (but above absolute floor):
   *       RLV is discounted by an additional 40% safety margin.
   */
  property_status?: "CRITICAL_DEVELOPMENT_RISK";
}

// ─── NBE Underwriter ──────────────────────────────────────────────────────────

/**
 * Calculates the True Residual Land Value using the Net Buildable Envelope
 * (NBE) model.
 *
 * Formula:
 *   Net Buildable Envelope  = Gross Site Area − Total Area Deductions
 *   Land Base Value/m²      = resolveSuburbBaseRate(suburb)
 *   Slope Penalty Rate      = calculateTieredSlopePenaltyRate(average_slope_degrees)
 *   Raw Land Value          = NBE × Land Base Value per m²
 *   Topographical Penalty   = Raw Land Value × Slope Penalty Rate
 *   True RLV                = Raw Land Value − Topographical Penalty
 *
 * Critical Risk Floors (two tiers, checked in order of severity):
 *
 *   Absolute floor — NBE < 100 m² OR NBE < 20% of gross site area:
 *     property_status = "CRITICAL_DEVELOPMENT_RISK".
 *     Purchase price is capped at non-developable bare-land value
 *     (gross site area × $500/m²). Slope-adjusted RLV is discarded.
 *
 *   Severe floor — NBE < 150 m² (but above the absolute floor):
 *     property_status = "CRITICAL_DEVELOPMENT_RISK".
 *     Slope-adjusted RLV is discounted by an additional 40% safety margin.
 *
 * @param inputs - NBE valuation inputs including gross area, deductions, suburb, and slope.
 */
export function calculateNBEValuation(inputs: NBEInputs): NBEValuationResult {
  const { gross_site_area_m2, land_deductions, suburb, average_slope_degrees, zone } = inputs;

  const land_base_value_per_m2_nzd = resolveSuburbBaseRate(suburb);
  const slope_penalty_rate = calculateTieredSlopePenaltyRate(average_slope_degrees);

  // ── Zone coverage deduction (legal capacity limit, applied before physical penalties) ──
  let zone_coverage_deduction_m2: number | undefined;
  let zone_adjusted_area = gross_site_area_m2;
  if (zone) {
    const zoneCoverage = resolveZoneCoverageDeduction(zone, gross_site_area_m2);
    zone_coverage_deduction_m2 = zoneCoverage.zone_deduction_m2;
    zone_adjusted_area = zoneCoverage.legal_coverage_area_m2;
  }

  // ── Physical infrastructure deductions ────────────────────────────────────
  const netBuildableEnvelope = zone_adjusted_area - land_deductions.total_deduction_m2;

  const nbeRatio = netBuildableEnvelope / gross_site_area_m2;

  const rawLandValue = netBuildableEnvelope * land_base_value_per_m2_nzd;
  const topographicalPenalty = Math.round(rawLandValue * slope_penalty_rate);
  let trueRLV = Math.round(rawLandValue - topographicalPenalty);

  let propertyStatus: "CRITICAL_DEVELOPMENT_RISK" | undefined;
  let nonDevelopableLandValue: number | undefined;

  if (
    netBuildableEnvelope < ABSOLUTE_NBE_FLOOR_M2 ||
    nbeRatio < ABSOLUTE_NBE_RATIO_FLOOR
  ) {
    // Absolute floor: site cannot support viable development.
    // Cap the purchase price at bare non-developable land value.
    propertyStatus = "CRITICAL_DEVELOPMENT_RISK";
    nonDevelopableLandValue = Math.round(
      gross_site_area_m2 * NON_DEVELOPABLE_LAND_RATE_PER_M2_NZD
    );
    trueRLV = nonDevelopableLandValue;
  } else if (netBuildableEnvelope < CRITICAL_NBE_FLOOR_M2) {
    // Severe floor: NBE is constrained but not fully non-developable.
    // Apply extra 40% safety margin haircut.
    propertyStatus = "CRITICAL_DEVELOPMENT_RISK";
    trueRLV = Math.round(trueRLV * (1 - CRITICAL_NBE_SAFETY_MARGIN));
  }

  return {
    gross_area_m2: gross_site_area_m2,
    net_buildable_envelope_m2: netBuildableEnvelope,
    suburb,
    land_base_value_per_m2_nzd,
    slope_penalty_rate,
    raw_land_value_nzd: Math.round(rawLandValue),
    topographical_penalty_nzd: topographicalPenalty,
    true_residual_land_value_nzd: trueRLV,
    nbe_ratio: Math.round(nbeRatio * 1000) / 1000,
    ...(zone !== undefined && { aup_zone: zone }),
    ...(zone_coverage_deduction_m2 !== undefined && { zone_coverage_deduction_m2 }),
    ...(nonDevelopableLandValue !== undefined && { non_developable_land_value_nzd: nonDevelopableLandValue }),
    ...(propertyStatus !== undefined && { property_status: propertyStatus }),
  };
}

// ─── AuditVerdict ─────────────────────────────────────────────────────────────

/**
 * Master output object that combines results from all three TerraAI modules.
 *
 * Assemble via `buildAuditVerdict()`.
 */
export interface AuditVerdict {
  /** ISO 8601 timestamp of when the audit was run */
  timestamp: string;
  /** Address or identifier for the property under assessment */
  property_address: string;
  /** Results from linz-connector.ts */
  linz: LINZAuditSlice;
  /** Results from infrastructure-ghost.ts */
  infrastructure: InfrastructureAuditSlice;
  /** Results from valuation-engine.ts */
  valuation: ValuationResult;
  /**
   * Composite risk level derived from infrastructure and feasibility signals.
   * Highest risk across all modules wins.
   */
  overall_risk: RiskLevel;
  /**
   * One-line plain-English verdict for dashboard display.
   * e.g. "MONEY PIT — High infrastructure risk & negative RLV."
   */
  headline: string;
}

function deriveOverallRisk(
  infraRisk: RiskLevel,
  feasibility: FeasibilityVerdict
): RiskLevel {
  const riskOrder: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const feasRisk: RiskLevel =
    feasibility === "UNVIABLE"
      ? "CRITICAL"
      : feasibility === "CAUTION"
      ? "HIGH"
      : feasibility === "MARGINAL"
      ? "MEDIUM"
      : "LOW";

  return riskOrder.indexOf(infraRisk) >= riskOrder.indexOf(feasRisk)
    ? infraRisk
    : feasRisk;
}

function buildHeadline(
  overallRisk: RiskLevel,
  feasibility: FeasibilityVerdict,
  infraFaultCount: number
): string {
  if (overallRisk === "CRITICAL" || feasibility === "UNVIABLE") {
    return "MONEY PIT — Negative residual land value and/or critical infrastructure risk.";
  }
  if (overallRisk === "HIGH") {
    return `HIGH RISK — ${infraFaultCount} infrastructure fault(s) detected. Budget overruns likely.`;
  }
  if (overallRisk === "MEDIUM" || feasibility === "MARGINAL") {
    return "PROCEED WITH CAUTION — Marginal feasibility or moderate infrastructure pressure.";
  }
  return "GOLD MINE — Strong feasibility with no material infrastructure constraints.";
}

/**
 * Assembles the final AuditVerdict JSON from all three module outputs.
 *
 * @param linz           - Output from linz-connector.ts
 * @param infrastructure - Output from infrastructure-ghost.ts
 * @param valuation      - Output from calculateRLV()
 */
export function buildAuditVerdict(
  linz: LINZAuditSlice,
  infrastructure: InfrastructureAuditSlice,
  valuation: ValuationResult
): AuditVerdict {
  const overallRisk = deriveOverallRisk(
    infrastructure.report.overall_risk,
    valuation.feasibility
  );

  return {
    timestamp: new Date().toISOString(),
    property_address: valuation.property_address,
    linz,
    infrastructure,
    valuation,
    overall_risk: overallRisk,
    headline: buildHeadline(
      overallRisk,
      valuation.feasibility,
      infrastructure.report.faults.length
    ),
  };
}
