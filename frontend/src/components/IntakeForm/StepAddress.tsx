import { PropertyFormData } from "@/lib/types";

interface StepAddressProps {
  data: PropertyFormData;
  onChange: (updates: Partial<PropertyFormData>) => void;
}

export default function StepAddress({ data, onChange }: StepAddressProps) {
  return (
    <div className="space-y-5 animate-slide-up">
      <div>
        <h2 className="text-2xl font-bold text-terra-text">
          Property Address
        </h2>
        <p className="text-terra-muted text-sm mt-1">
          Auckland supported in Phase 1 MVP. Trans-Tasman expansion in Phase 3.
        </p>
      </div>

      <div>
        <label htmlFor="address" className="terra-label">
          Street Address
        </label>
        <input
          id="address"
          type="text"
          className="terra-input"
          placeholder="e.g. 123 Ponsonby Road"
          value={data.address}
          onChange={(e) => onChange({ address: e.target.value })}
          autoComplete="street-address"
        />
        <p className="text-xs text-terra-muted mt-1.5">
          Google Maps autocomplete activates once{" "}
          <code className="text-terra-teal text-[11px]">
            NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
          </code>{" "}
          is set in <code className="text-terra-teal text-[11px]">.env.local</code>.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="suburb" className="terra-label">
            Suburb
          </label>
          <input
            id="suburb"
            type="text"
            className="terra-input"
            placeholder="e.g. Ponsonby"
            value={data.suburb}
            onChange={(e) => onChange({ suburb: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="city" className="terra-label">
            City
          </label>
          <select
            id="city"
            className="terra-input"
            value={data.city}
            onChange={(e) => onChange({ city: e.target.value })}
          >
            <option value="Auckland">Auckland</option>
            <option value="Sydney" disabled>
              Sydney (Phase 3)
            </option>
            <option value="Melbourne" disabled>
              Melbourne (Phase 3)
            </option>
          </select>
        </div>
      </div>
    </div>
  );
}
