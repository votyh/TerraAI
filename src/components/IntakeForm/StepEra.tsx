import { PropertyFormData, EraOption } from "@/lib/types";

interface StepEraProps {
  data: PropertyFormData;
  onChange: (updates: Partial<PropertyFormData>) => void;
}

const ERA_OPTIONS: {
  value: EraOption;
  label: string;
  description: string;
}[] = [
  {
    value: "pre-1940",
    label: "Pre-1940",
    description: "Villa / Bungalow era — potential character heritage overlay",
  },
  {
    value: "1940s-1960s",
    label: "1940s – 1960s",
    description: "Post-war state house era, often concrete block construction",
  },
  {
    value: "1970s-1990s",
    label: "1970s – 1990s",
    description:
      "⚠️ Weathertightness risk era — monolithic cladding, leaky building potential",
  },
  {
    value: "2000s-2010s",
    label: "2000s – 2010s",
    description:
      "Post-weathertight reform construction, modern compliance standards",
  },
  {
    value: "2010s-present",
    label: "2010s – Present",
    description:
      "Contemporary build, energy efficiency compliance, NZ Building Code 2011+",
  },
];

export default function StepEra({ data, onChange }: StepEraProps) {
  return (
    <div className="space-y-5 animate-slide-up">
      <div>
        <h2 className="text-2xl font-bold text-terra-text">Build Era</h2>
        <p className="text-terra-muted text-sm mt-1">
          Era influences risk scoring for weathertightness and structural
          compliance — a key variable in the valuation model.
        </p>
      </div>

      <div className="space-y-2.5">
        {ERA_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange({ era: option.value })}
            className={`w-full text-left p-4 rounded-lg border transition-all duration-200 ${
              data.era === option.value
                ? "border-terra-gold bg-terra-gold/10 text-terra-text"
                : "border-terra-border bg-terra-surface hover:border-terra-muted/50 text-terra-muted"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">{option.label}</span>
              {data.era === option.value && (
                <span className="text-terra-gold text-base">✓</span>
              )}
            </div>
            <p className="text-xs mt-1 opacity-70 leading-relaxed">
              {option.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
