import { ValuationResponse, PropertyFormData } from "@/lib/types";

interface ValuationResultProps {
  result: ValuationResponse;
  propertyData: PropertyFormData;
  onReset: () => void;
}

function formatNZD(amount: number): string {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    maximumFractionDigits: 0,
  }).format(amount);
}

const RISK_STYLES: Record<string, string> = {
  low: "text-terra-teal border-terra-teal bg-terra-teal/10",
  medium: "text-yellow-400 border-yellow-700/60 bg-yellow-900/10",
  high: "text-red-400 border-red-700/60 bg-red-900/10",
};

export default function ValuationResult({
  result,
  propertyData,
  onReset,
}: ValuationResultProps) {
  const riskStyle = RISK_STYLES[result.risk_level] ?? RISK_STYLES.medium;

  return (
    <div className="space-y-4 animate-slide-up">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-terra-text">
            Indicative Report
          </h2>
          <p className="text-terra-muted text-sm mt-0.5 truncate">
            {propertyData.address}, {propertyData.suburb}
          </p>
        </div>
        <span
          className={`flex-shrink-0 text-xs font-semibold px-3 py-1 rounded-full border ${riskStyle}`}
        >
          {result.risk_level.toUpperCase()} RISK
        </span>
      </div>

      {/* Headline value */}
      <div className="terra-card text-center py-8">
        <p className="text-terra-muted text-xs uppercase tracking-widest mb-2">
          Indicative Estimated Value
        </p>
        <p className="text-4xl font-bold text-terra-gold">
          {formatNZD(result.estimated_value_nzd)}
        </p>
        <p className="text-terra-muted text-sm mt-2">
          {formatNZD(result.price_per_sqm_nzd)} / m² &nbsp;·&nbsp; Confidence{" "}
          {result.confidence_score}%
        </p>
        <p className="text-xs text-terra-muted/50 mt-3">
          {propertyData.sqm} m² · {propertyData.beds}bed / {propertyData.baths}
          bath · {propertyData.era} · {propertyData.condition}
        </p>
      </div>

      {/* Analysis notes */}
      {[
        { heading: "Flood Risk", text: result.flood_risk_note },
        { heading: "Zoning", text: result.zoning_note },
      ].map(({ heading, text }) => (
        <div
          key={heading}
          className="p-3.5 rounded-lg bg-terra-surface border border-terra-border"
        >
          <p className="text-xs font-semibold text-terra-muted uppercase tracking-widest mb-1">
            {heading}
          </p>
          <p className="text-sm text-terra-text leading-relaxed">{text}</p>
        </div>
      ))}

      {/* Data sources */}
      <div className="p-3.5 rounded-lg bg-terra-surface border border-terra-border">
        <p className="text-xs font-semibold text-terra-muted uppercase tracking-widest mb-2">
          Data Sources
        </p>
        <ul className="space-y-0.5">
          {result.data_sources.map((src, i) => (
            <li key={i} className="text-xs text-terra-muted">
              · {src}
            </li>
          ))}
        </ul>
      </div>

      {/* LAWYER_SHIELD §1 — Disclaimer callout */}
      <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-terra-gold/5 border border-terra-gold/30">
        <span className="text-terra-gold text-base flex-shrink-0 mt-0.5">
          🛡️
        </span>
        <p className="text-xs text-terra-muted leading-relaxed">
          {result.disclaimer}
        </p>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="terra-btn-secondary w-full"
      >
        ← Run Another Analysis
      </button>
    </div>
  );
}
