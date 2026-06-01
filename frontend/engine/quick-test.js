require('dotenv/config'); // load .env into process.env before any network layer initializes
require('tsx/cjs');      // hook into Node's module loader so require() can load .ts files

const { fetchParcelByCoordinate } = require('./linz-connector');

// quick-test.js â€” TerraAI NBE Model Â· Live LINZ Pipeline
//
// Step 1 â€” fetchParcelByCoordinate (linz-connector.ts)
//   Hits LINZ WFS Layer 50772 and returns the real calc_area_m2 for the parcel.
// Step 2 â€” calculateLandAreaDeductions
//   Subtracts known infrastructure corridors from the live gross area.
// Step 3 â€” calculateNBEValuation
//   Applies suburb base rate + tiered slope penalty to produce the True RLV.

// â”€â”€â”€ Inline: Suburb Price Matrix â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SUBURB_PRICE_MATRIX = {
    "Remuera":   5000,
    "Ponsonby":  5500,
    "Manukau":   2200,
    "Henderson": 2000,
};

function resolveSuburbBaseRate(suburb) {
    const rate = SUBURB_PRICE_MATRIX[suburb];
    if (rate === undefined) {
        throw new Error(`Unknown suburb "${suburb}". Add it to SUBURB_PRICE_MATRIX before running a valuation.`);
    }
    return rate;
}

// â”€â”€â”€ Inline: Tiered Slope Penalty â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Tiered escalator for the NBE land-value slope penalty.
 *   0â€“5Â°   â†’ 0%
 *   5â€“15Â°  â†’ 15%
 *   15â€“25Â° â†’ 35%
 *   >25Â°   â†’ 55%
 */
function calculateTieredSlopePenaltyRate(slope_degrees) {
    if (slope_degrees <= 5)  return 0.00;
    if (slope_degrees <= 15) return 0.15;
    if (slope_degrees <= 25) return 0.35;
    return 0.55;
}

// â”€â”€â”€ Inline: calculateLandAreaDeductions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const STORMWATER_PIPE_CORRIDOR_DEDUCTION_M2 = 54;  // 18 m pipe Ã— 3 m corridor
const OVERLAND_FLOW_PATH_DEDUCTION_M2 = 120;

function calculateLandAreaDeductions(parcelGeometry, constraints) {
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

// â”€â”€â”€ Inline: calculateNBEValuation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const CRITICAL_NBE_FLOOR_M2 = 150;
const CRITICAL_NBE_SAFETY_MARGIN = 0.40;

// ─── Inline: AUP Zone Coverage Profiles ──────────────────────────────────────────

const AUP_ZONE_PROFILES = {
    MHU:  { description: 'Mixed Housing Urban',               max_coverage_pct: 45 },
    MHS:  { description: 'Mixed Housing Suburban',            max_coverage_pct: 40 },
    THAB: { description: 'Terrace Housing & Apartments',      max_coverage_pct: 50 },
};

function resolveZoneCoverageDeduction(zone, gross_area_m2) {
    const profile = AUP_ZONE_PROFILES[zone];
    if (!profile) throw new Error(`Unknown AUP zone "${zone}".`);
    const legal_coverage_area_m2 = Math.round(gross_area_m2 * (profile.max_coverage_pct / 100));
    return {
        zone,
        description:              profile.description,
        max_coverage_pct:         profile.max_coverage_pct,
        legal_coverage_area_m2,
        zone_deduction_m2:        gross_area_m2 - legal_coverage_area_m2,
    };
}

function calculateNBEValuation(inputs) {
    const {
        gross_site_area_m2,
        land_deductions,
        suburb,
        average_slope_degrees,
        zone,
    } = inputs;

    const land_base_value_per_m2_nzd = resolveSuburbBaseRate(suburb);
    const slope_penalty_rate = calculateTieredSlopePenaltyRate(average_slope_degrees);

    // ── Zone coverage deduction (legal capacity limit, applied before physical penalties) ──
    let zoneCoverageResult = null;
    let zone_adjusted_area = gross_site_area_m2;
    if (zone) {
        zoneCoverageResult = resolveZoneCoverageDeduction(zone, gross_site_area_m2);
        zone_adjusted_area = zoneCoverageResult.legal_coverage_area_m2;
    }

    // ── Physical infrastructure deductions ───────────────────────────────────
    const netBuildableEnvelope = zone_adjusted_area - land_deductions.total_deduction_m2;

    const rawLandValue = netBuildableEnvelope * land_base_value_per_m2_nzd;

    const topographicalPenalty = Math.round(
        rawLandValue * slope_penalty_rate
    );

    let trueRLV = Math.round(rawLandValue - topographicalPenalty);
    let propertyStatus;

    if (netBuildableEnvelope < CRITICAL_NBE_FLOOR_M2) {
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
        property_status: propertyStatus,
        aup_zone:                  zone ?? null,
        zone_coverage_deduction_m2: zoneCoverageResult ? zoneCoverageResult.zone_deduction_m2 : 0,
    };
}

// â”€â”€â”€ Live LINZ Pipeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// WGS-84 point for 17 Ohinerau St, Remuera, Auckland (EPSG:4326).
// LINZ WFS resolves the parcel whose boundary contains this coordinate.
const OHINERAU_COORDINATE = { lng: 174.7927, lat: -36.8777 };

// Used if the LINZ call is unavailable (no key, network error, or null area).
const FALLBACK_AREA_M2 = 740;

async function main() {
    const apiKey = process.env.LINZ_API_KEY ?? '';

    let gross_site_area_m2 = FALLBACK_AREA_M2;
    let areaSource         = `FALLBACK â€” static ${FALLBACK_AREA_M2} mÂ²`;
    let parcelId           = null;
    let appellation        = null;
    let parcelIntent       = null;

    // â”€â”€ Step 1: Fetch live parcel geometry from LINZ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    console.log('[LINZ] Querying Layer 50772 â€” 17 Ohinerau St, Remuera...');

    if (!apiKey) {
        console.log('[LINZ] âš   LINZ_API_KEY not found in .env â€” using static fallback area.');
    } else {
        // preferredParcelId pins the result to the verified Fee Simple parcel
        // for 17 Ohinerau St (ID confirmed via diagnostic BBOX scan).
        const linzResult = await fetchParcelByCoordinate(apiKey, OHINERAU_COORDINATE, {
            preferredParcelId: 6689082,
        });

        if (linzResult.success) {
            const d = linzResult.data;
            parcelId     = d.parcel_id;
            appellation  = d.appellation;
            parcelIntent = d.parcel_intent;

            if (d.calc_area_m2 !== null && d.calc_area_m2 > 0) {
                gross_site_area_m2 = d.calc_area_m2;
                areaSource = `LINZ live  (Layer 50772 Â· parcel #${parcelId})`;
                console.log(`[LINZ] âœ“  Resolved: ${appellation ?? 'n/a'}  |  calc_area: ${gross_site_area_m2} mÂ²`);
            } else {
                console.log('[LINZ] âš   calc_area_m2 absent on returned feature â€” using static fallback area.');
            }
        } else {
            console.log(`[LINZ] âœ—  ${linzResult.error.code}: ${linzResult.error.message}`);
            console.log('[LINZ]    Proceeding with static fallback area.');
        }
    }

    // â”€â”€ Step 2: Infrastructure deductions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const parcelGeometry = { parcel_boundary: { exterior: [] } };

    const constraints = {
        has_stormwater_pipe_corridor: true,
        has_overland_flow_path: true,
    };

    const deductions = calculateLandAreaDeductions(parcelGeometry, constraints);

    // â”€â”€ Step 3: NBE underwriting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const nbeResult = calculateNBEValuation({
        gross_site_area_m2,
        land_deductions: deductions,
        suburb: "Remuera",
        average_slope_degrees: 18,
        zone: "MHU",
    });

    // â”€â”€â”€ Institutional Telemetry Output â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    console.log("===========================================");
    console.log("  TERRAAI â€” INSTITUTIONAL LAND AUDIT");
    console.log("  Property: 17 Ohinerau St, Remuera");
    console.log("===========================================");
    if (parcelId !== null) {
        console.log("LINZ PARCEL ID:                     #" + parcelId);
        console.log("APPELLATION:                        " + (appellation ?? "n/a"));
        console.log("PARCEL INTENT:                      " + (parcelIntent ?? "n/a"));
    }
    console.log("AREA SOURCE:                        " + areaSource);
    console.log("SUBURB:                             " + nbeResult.suburb);
    console.log("BASE RATE:                          $" + nbeResult.land_base_value_per_m2_nzd.toLocaleString() + "/mÂ²");
    console.log("SLOPE INPUT:                        18Â°  â†’  tier " + (nbeResult.slope_penalty_rate * 100).toFixed(0) + "% penalty  (15â€“25Â° bracket)");
    console.log("GROSS AREA:                         " + nbeResult.gross_area_m2 + " mÂ²");
    console.log("  â”œâ”€ Stormwater pipe corridor:  âˆ’" + deductions.stormwater_pipe_corridor_m2 + " mÂ²  (18 m pipe Ã— 3 m corridor)");
    console.log("  â””â”€ Overland flow path buffer: âˆ’" + deductions.overland_flow_path_m2 + " mÂ²  (active constraint)");
    console.log("NET BUILDABLE ENVELOPE (NBE):       " + nbeResult.net_buildable_envelope_m2 + " mÂ²");
    if (nbeResult.property_status === "CRITICAL_DEVELOPMENT_RISK") {
        console.log("  âš  PROPERTY STATUS:              " + nbeResult.property_status);
        console.log("  âš  EXTRA 40% SAFETY MARGIN APPLIED TO RLV");
    }
    console.log("-------------------------------------------");
    console.log("BASE LAND VALUE (NBE Ã— $" + nbeResult.land_base_value_per_m2_nzd.toLocaleString() + "/mÂ²): $" + nbeResult.raw_land_value_nzd.toLocaleString());
    console.log("TOPOGRAPHICAL PENALTY (" + (nbeResult.slope_penalty_rate * 100).toFixed(0) + "% of NBE): âˆ’$" + nbeResult.topographical_penalty_nzd.toLocaleString());
    console.log("-------------------------------------------");
    console.log("TRUE RESIDUAL LAND VALUE (RLV):     $" + nbeResult.true_residual_land_value_nzd.toLocaleString());
    if (nbeResult.aup_zone) {
        const zp = AUP_ZONE_PROFILES[nbeResult.aup_zone];
        console.log("-------------------------------------------");
        console.log("AUP ZONE:                           " + nbeResult.aup_zone + "  (" + zp.description + ")");
        console.log("MAX SITE COVERAGE:                  " + zp.max_coverage_pct + "%  of gross site area");
        console.log("ZONE COVERAGE DEDUCTION:            -" + nbeResult.zone_coverage_deduction_m2 + " m2  (applied before structural penalties)");
    }
    console.log("===========================================");
}

main().catch(console.error);
