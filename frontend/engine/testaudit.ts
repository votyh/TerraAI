// E:\TerraAI\engine\test-audit.ts
import { calculateRLV } from './valuation-engine';

// --- INPUT YOUR DATA HERE ---
const ohinerauStreetData = {
  property_address: "17 Ohinerau Street, Remuera",
  estimated_end_sale_value_nzd: 7500000, // 3 units @ $2.5M
  topography: {
    average_slope_degrees: 15          // From your GeoMaps contours
  },
  construction: {
    base_construction_cost_nzd: 1800000, // $4k/m2 for 450m2 total
    gross_floor_area_m2: 450,
    professional_fees_nzd: 250000
  },
  infrastructure_cost_nzd: 50000        // Estimated pipe/utility buffer
};

// --- RUN THE ENGINE ---
const result = calculateRLV(ohinerauStreetData);

// --- VIEW THE VERDICT ---
console.log("==============================");
console.log("TERRAAI INTERNAL AUDIT");
console.log("==============================");
console.log(`ADDRESS: ${result.property_address}`);
console.log(`FEASIBILITY: ${result.feasibility}`);
console.log(`RLV: $${result.residual_land_value_nzd.toLocaleString()}`);
console.log(`SUMMARY: ${result.summary}`);
console.log("==============================");