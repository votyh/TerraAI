import { PropertyFormData } from "@/lib/types";

interface StepPropertyProps {
  data: PropertyFormData;
  onChange: (updates: Partial<PropertyFormData>) => void;
}

export default function StepProperty({ data, onChange }: StepPropertyProps) {
  return (
    <div className="space-y-5 animate-slide-up">
      <div>
        <h2 className="text-2xl font-bold text-terra-text">
          Property Details
        </h2>
        <p className="text-terra-muted text-sm mt-1">
          Used in the $/m² valuation model. Bedroom and bathroom counts apply
          premium multipliers.
        </p>
      </div>

      <div>
        <label htmlFor="sqm" className="terra-label">
          Floor Area (m²)
        </label>
        <input
          id="sqm"
          type="number"
          min="10"
          max="5000"
          step="1"
          className="terra-input"
          placeholder="e.g. 180"
          value={data.sqm}
          onChange={(e) => onChange({ sqm: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="beds" className="terra-label">
            Bedrooms
          </label>
          <select
            id="beds"
            className="terra-input"
            value={data.beds}
            onChange={(e) => onChange({ beds: e.target.value })}
          >
            <option value="">Select</option>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "Bedroom" : n === 6 ? "Bedrooms +" : "Bedrooms"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="baths" className="terra-label">
            Bathrooms
          </label>
          <select
            id="baths"
            className="terra-input"
            value={data.baths}
            onChange={(e) => onChange({ baths: e.target.value })}
          >
            <option value="">Select</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "Bathroom" : "Bathrooms"}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
