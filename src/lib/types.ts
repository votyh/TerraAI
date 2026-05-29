// ─── Property Intake Form ─────────────────────────────────────────────────────

export type EraOption =
  | "pre-1940"
  | "1940s-1960s"
  | "1970s-1990s"
  | "2000s-2010s"
  | "2010s-present";

export type ConditionOption = "excellent" | "good" | "fair" | "poor";

/** 0=Address 1=Property 2=Era 3=Condition 4=Photos */
export type FormStep = 0 | 1 | 2 | 3 | 4;

export interface PropertyFormData {
  // Step 0: Address
  address: string;
  suburb: string;
  city: string;
  // Step 1: Property dimensions
  sqm: string;
  beds: string;
  baths: string;
  // Step 2: Build era
  era: EraOption | "";
  // Step 3: Condition
  condition: ConditionOption | "";
  // Step 4: Visual Valuator photos
  frontagePhoto: File | null;
  kitchenPhoto: File | null;
}

export const INITIAL_FORM_DATA: PropertyFormData = {
  address: "",
  suburb: "",
  city: "Auckland",
  sqm: "",
  beds: "",
  baths: "",
  era: "",
  condition: "",
  frontagePhoto: null,
  kitchenPhoto: null,
};

// ─── Valuation API ────────────────────────────────────────────────────────────

export interface ValuationRequest {
  address: string;
  suburb: string;
  city: string;
  sqm: number;
  beds: number;
  baths: number;
  era: EraOption;
  condition: ConditionOption;
}

export interface ValuationResponse {
  estimated_value_nzd: number;
  price_per_sqm_nzd: number;
  confidence_score: number;
  risk_level: "low" | "medium" | "high";
  flood_risk_note: string;
  zoning_note: string;
  disclaimer: string;
  data_sources: string[];
}
