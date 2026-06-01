import { PropertyFormData, ConditionOption } from "@/lib/types";

interface StepConditionProps {
  data: PropertyFormData;
  onChange: (updates: Partial<PropertyFormData>) => void;
}

const CONDITION_OPTIONS: {
  value: ConditionOption;
  label: string;
  description: string;
  icon: string;
  multiplier: string;
}[] = [
  {
    value: "excellent",
    label: "Excellent",
    description: "Fully renovated, move-in ready, premium finishes throughout",
    icon: "⭐",
    multiplier: "+15%",
  },
  {
    value: "good",
    label: "Good",
    description: "Well-maintained, minor cosmetic updates needed",
    icon: "✅",
    multiplier: "+5%",
  },
  {
    value: "fair",
    label: "Fair",
    description: "Habitable but requires significant renovation work",
    icon: "🔧",
    multiplier: "Baseline",
  },
  {
    value: "poor",
    label: "Poor",
    description: "Major structural or code-compliance issues present",
    icon: "⚠️",
    multiplier: "−20%",
  },
];

export default function StepCondition({ data, onChange }: StepConditionProps) {
  return (
    <div className="space-y-5 animate-slide-up">
      <div>
        <h2 className="text-2xl font-bold text-terra-text">
          Property Condition
        </h2>
        <p className="text-terra-muted text-sm mt-1">
          Condition applies a multiplier to the AI-estimated baseline value.
          Photos in the next step help verify this assessment.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {CONDITION_OPTIONS.map((option) => {
          const isSelected = data.condition === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange({ condition: option.value })}
              className={`text-left p-4 rounded-lg border transition-all duration-200 ${
                isSelected
                  ? "border-terra-gold bg-terra-gold/10 text-terra-text"
                  : "border-terra-border bg-terra-surface hover:border-terra-muted/50 text-terra-muted"
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-lg">{option.icon}</span>
                <span className="font-semibold text-sm">{option.label}</span>
              </div>
              <p className="text-xs opacity-70 mb-3 leading-relaxed">
                {option.description}
              </p>
              <span
                className={`text-xs font-mono px-2 py-0.5 rounded ${
                  isSelected
                    ? "bg-terra-gold/20 text-terra-gold"
                    : "bg-terra-border/60 text-terra-muted"
                }`}
              >
                {option.multiplier} to baseline
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
