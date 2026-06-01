"use client";

import { useState } from "react";

interface DisclaimerModalProps {
  onAgree: () => void;
}

/**
 * DisclaimerModal — LAWYER_SHIELD enforcement gate.
 * User must scroll to the bottom of the disclaimer before the "I Agree"
 * button becomes active. Satisfies the Terms of Service click-through
 * requirement from LAWYER_SHIELD.md §3.
 */
export default function DisclaimerModal({ onAgree }: DisclaimerModalProps) {
  const [hasScrolled, setHasScrolled] = useState(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const nearBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 50;
    if (nearBottom) setHasScrolled(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-terra-dark/90 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-2xl terra-card flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5 pb-4 border-b border-terra-border">
          <span className="text-2xl">🛡️</span>
          <div>
            <h2 className="text-xl font-bold text-terra-text">
              Terms of Service
            </h2>
            <p className="text-xs text-terra-muted mt-0.5">
              Read in full before proceeding — scroll to enable agreement
            </p>
          </div>
        </div>

        {/* Scrollable disclaimer body */}
        <div
          onScroll={handleScroll}
          className="overflow-y-auto pr-2 space-y-4 text-sm text-terra-muted leading-relaxed rounded-lg border border-terra-border p-4 mb-4"
          style={{ maxHeight: "46vh" }}
        >
          <p className="text-terra-text font-semibold text-base">
            TerraAI Master Disclaimer
          </p>

          <p>
            TerraAI is an automated data aggregation and synthesis tool. The
            information provided, including any estimated property values, risk
            scores, or feasibility analyses, is generated via Artificial
            Intelligence and public datasets.
          </p>

          <p className="text-terra-gold font-semibold">
            TerraAI is NOT a Registered Valuation, a Geotechnical Assessment, a
            Structural Survey, or Legal Advice.
          </p>

          <p>
            All data is provided for informational and &lsquo;indicative&rsquo;
            purposes only. Users are strictly advised to verify all findings
            with a licensed professional (e.g., Registered Valuer, Solicitor,
            or Engineer) prior to any financial transaction or development
            commitment.
          </p>

          <p className="text-terra-text font-semibold pt-2">Liability Cap</p>
          <p>
            Total liability is strictly limited to the purchase price of the
            report (e.g., $49 NZD). Data is provided &lsquo;as-is&rsquo; based
            on the snapshot of public records available at the time of the scan.
          </p>

          <p className="text-terra-text font-semibold pt-2">
            Visual Valuator Disclaimer
          </p>
          <p>
            Material analysis is based on user-provided imagery. Accuracy is
            dependent on photo quality and may not reflect hidden structural
            defects.
          </p>

          <p className="text-terra-text font-semibold pt-2">Data Provenance</p>
          <p>
            Flood risk data is extrapolated from Auckland Council GIS Dataset
            v2025. Zoning data is sourced via LINZ / Auckland Unitary Plan
            portal. If the primary data source contains errors, liability rests
            with the municipal provider, not the TerraAI synthesis layer.
          </p>

          <p className="text-terra-text font-semibold pt-2">
            Zero Hallucination Policy
          </p>
          <p>
            If a specific data vector (e.g., land slope, school zone, flood
            depth) cannot be verified with 95% confidence, the report will
            state &ldquo;Data Unavailable&rdquo; rather than generating a best
            guess.
          </p>

          <p className="text-xs text-terra-muted/70 pt-4 border-t border-terra-border">
            By clicking &ldquo;I Agree&rdquo; below, you confirm that you have
            read and understood these terms, and that you accept full
            responsibility for how you use this indicative data.
          </p>
        </div>

        {!hasScrolled && (
          <p className="text-xs text-terra-muted text-center mb-3 animate-pulse">
            ↓ Scroll to the bottom to unlock agreement
          </p>
        )}

        <button
          onClick={onAgree}
          disabled={!hasScrolled}
          className="terra-btn-primary w-full text-base py-3.5"
        >
          {hasScrolled
            ? "✓  I Agree — Proceed to Analysis"
            : "Read Full Terms to Continue"}
        </button>
      </div>
    </div>
  );
}
