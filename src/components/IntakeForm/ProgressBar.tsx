const STEP_LABELS = ["Address", "Property", "Build Era", "Condition", "Photos"];

interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
}

export default function ProgressBar({
  currentStep,
  totalSteps,
}: ProgressBarProps) {
  return (
    <div className="w-full mb-8">
      {/* Step labels */}
      <div className="flex justify-between mb-2">
        {STEP_LABELS.map((label, index) => (
          <span
            key={label}
            className={`text-xs font-medium transition-colors hidden sm:block ${
              index === currentStep
                ? "text-terra-gold"
                : index < currentStep
                  ? "text-terra-teal"
                  : "text-terra-border"
            }`}
          >
            {label}
          </span>
        ))}
      </div>

      {/* Progress track */}
      <div className="h-1.5 bg-terra-border rounded-full overflow-hidden">
        <div
          className="h-full bg-gold-gradient rounded-full transition-all duration-500 ease-out"
          style={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
        />
      </div>

      {/* Mobile step counter */}
      <div className="flex justify-between items-center mt-1.5">
        <span className="text-xs text-terra-gold font-medium sm:hidden">
          {STEP_LABELS[currentStep]}
        </span>
        <span className="text-xs text-terra-muted ml-auto">
          Step {currentStep + 1} of {totalSteps}
        </span>
      </div>
    </div>
  );
}
