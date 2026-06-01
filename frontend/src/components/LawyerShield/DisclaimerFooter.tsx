/**
 * DisclaimerFooter — rendered on every page via root layout.
 * Satisfies LAWYER_SHIELD.md §1 (Master Disclaimer front-and-centre)
 * and §3 (Data Provenance attribution).
 */
export default function DisclaimerFooter() {
  return (
    <footer className="border-t border-terra-border bg-terra-surface">
      <div className="max-w-7xl mx-auto px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row items-start gap-3">
          <span className="text-terra-gold text-lg flex-shrink-0 mt-0.5">
            🛡️
          </span>
          <p className="text-xs text-terra-muted leading-relaxed">
            <span className="font-semibold text-terra-text">
              TerraAI Legal Disclaimer:{" "}
            </span>
            TerraAI is an automated data aggregation tool. It is{" "}
            <strong className="text-terra-gold">NOT</strong> a Registered
            Valuation, Geotechnical Assessment, or Legal Advice. All data is
            synthesised from public sources (LINZ, Auckland Council GIS v2025)
            and must be verified by a licensed professional prior to any
            financial transaction. Liability is capped at the purchase price of
            the report.{" "}
            <span className="text-terra-muted/60">
              &copy; 2026 TerraAI. Phase 1 MVP — Auckland.
            </span>
          </p>
        </div>
      </div>
    </footer>
  );
}
