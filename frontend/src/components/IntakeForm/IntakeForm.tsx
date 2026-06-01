"use client";

import { useState } from "react";
import {
  PropertyFormData,
  INITIAL_FORM_DATA,
  FormStep,
  ValuationResponse,
} from "@/lib/types";
import ProgressBar from "./ProgressBar";
import StepAddress from "./StepAddress";
import StepProperty from "./StepProperty";
import StepEra from "./StepEra";
import StepCondition from "./StepCondition";
import VisualValuator from "@/components/VisualValuator/VisualValuator";
import ValuationResult from "@/components/ValuationResult/ValuationResult";

const TOTAL_STEPS = 5;

/** Returns true if all required fields for the given step are filled. */
function isStepValid(step: FormStep, data: PropertyFormData): boolean {
  switch (step) {
    case 0:
      return data.address.trim().length > 0 && data.suburb.trim().length > 0;
    case 1:
      return data.sqm !== "" && data.beds !== "" && data.baths !== "";
    case 2:
      return data.era !== "";
    case 3:
      return data.condition !== "";
    case 4:
      return true; // photos are optional
    default:
      return false;
  }
}

interface IntakeFormProps {
  /** True once the user has agreed to the DisclaimerModal. */
  hasAgreed: boolean;
}

export default function IntakeForm({ hasAgreed }: IntakeFormProps) {
  const [currentStep, setCurrentStep] = useState<FormStep>(0);
  const [formData, setFormData] = useState<PropertyFormData>(INITIAL_FORM_DATA);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ValuationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateFormData = (updates: Partial<PropertyFormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const handleNext = () => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep((s) => (s + 1) as FormStep);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((s) => (s - 1) as FormStep);
    }
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    setError(null);

    const apiUrl =
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

    try {
      const response = await fetch(`${apiUrl}/api/v1/valuate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: formData.address,
          suburb: formData.suburb,
          city: formData.city,
          sqm: Number(formData.sqm),
          beds: Number(formData.beds),
          baths: Number(formData.baths),
          era: formData.era,
          condition: formData.condition,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`API error ${response.status}: ${body}`);
      }

      const data: ValuationResponse = await response.json();
      setResult(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to reach the analysis engine. Make sure the FastAPI backend is running on port 8000."
      );
    } finally {
      setIsLoading(false);
    }
  };

  // ── Result view ────────────────────────────────────────────────────────────
  if (result) {
    return (
      <ValuationResult
        result={result}
        propertyData={formData}
        onReset={() => {
          setResult(null);
          setFormData(INITIAL_FORM_DATA);
          setCurrentStep(0);
        }}
      />
    );
  }

  const isLastStep = currentStep === TOTAL_STEPS - 1;
  const canAdvance = isStepValid(currentStep, formData);

  // ── Form view ──────────────────────────────────────────────────────────────
  return (
    <div className="terra-card w-full">
      <ProgressBar currentStep={currentStep} totalSteps={TOTAL_STEPS} />

      {/* Step content — min-height prevents layout jump between steps */}
      <div className="min-h-[340px]">
        {currentStep === 0 && (
          <StepAddress data={formData} onChange={updateFormData} />
        )}
        {currentStep === 1 && (
          <StepProperty data={formData} onChange={updateFormData} />
        )}
        {currentStep === 2 && (
          <StepEra data={formData} onChange={updateFormData} />
        )}
        {currentStep === 3 && (
          <StepCondition data={formData} onChange={updateFormData} />
        )}
        {currentStep === 4 && (
          <VisualValuator
            frontagePhoto={formData.frontagePhoto}
            kitchenPhoto={formData.kitchenPhoto}
            onFrontageChange={(file) => updateFormData({ frontagePhoto: file })}
            onKitchenChange={(file) => updateFormData({ kitchenPhoto: file })}
          />
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mt-4 p-3.5 rounded-lg bg-red-950/50 border border-red-700/60 text-red-300 text-sm leading-relaxed">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-3 mt-7">
        {currentStep > 0 && (
          <button
            type="button"
            onClick={handleBack}
            className="terra-btn-secondary flex-1"
            disabled={isLoading}
          >
            ← Back
          </button>
        )}

        {isLastStep ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isLoading || !hasAgreed}
            className="terra-btn-primary flex-1"
          >
            {isLoading ? (
              <>
                <span className="inline-block animate-spin">⟳</span>
                Analysing...
              </>
            ) : (
              "🔍  Analyse Property"
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleNext}
            disabled={!canAdvance}
            className="terra-btn-primary flex-1"
          >
            Continue →
          </button>
        )}
      </div>
    </div>
  );
}
