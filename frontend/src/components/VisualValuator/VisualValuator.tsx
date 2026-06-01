"use client";

import { useRef, useState, DragEvent, ChangeEvent } from "react";

// ─── Single upload zone ───────────────────────────────────────────────────────

interface UploadZoneProps {
  label: string;
  hint: string;
  file: File | null;
  onChange: (file: File | null) => void;
}

function UploadZone({ label, hint, file, onChange }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const processFile = (f: File) => {
    if (!f.type.startsWith("image/")) return;
    onChange(f);
    const reader = new FileReader();
    reader.onloadend = () => setPreview(reader.result as string);
    reader.readAsDataURL(f);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  };

  const handleRemove = () => {
    onChange(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="flex-1 min-w-0">
      <p className="terra-label">{label}</p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !preview && inputRef.current?.click()}
        className={`relative rounded-lg border-2 border-dashed overflow-hidden transition-all duration-200
          ${
            preview
              ? "border-terra-teal"
              : isDragging
                ? "border-terra-gold bg-terra-gold/5 scale-[1.01]"
                : "border-terra-border hover:border-terra-muted/70 cursor-pointer"
          }`}
      >
        {preview ? (
          /* Preview thumbnail */
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt={label}
              className="w-full h-40 object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-terra-dark/60 to-transparent" />
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
              <span className="text-xs text-white font-medium truncate">
                {file?.name}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove();
                }}
                className="ml-2 flex-shrink-0 bg-terra-dark/80 hover:bg-red-900/80 text-white text-xs px-2 py-0.5 rounded transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          /* Empty state */
          <div className="flex flex-col items-center justify-center p-6 min-h-[140px] text-center">
            <span className="text-3xl mb-2">📷</span>
            <p className="text-sm text-terra-muted">{hint}</p>
            <p className="text-xs text-terra-muted/50 mt-1">
              Tap to upload · Drag & drop · Mobile camera
            </p>
          </div>
        )}
      </div>

      {/* Hidden file input — capture="environment" opens rear camera on mobile */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}

// ─── Visual Valuator ─────────────────────────────────────────────────────────

interface VisualValuatorProps {
  frontagePhoto: File | null;
  kitchenPhoto: File | null;
  onFrontageChange: (file: File | null) => void;
  onKitchenChange: (file: File | null) => void;
}

export default function VisualValuator({
  frontagePhoto,
  kitchenPhoto,
  onFrontageChange,
  onKitchenChange,
}: VisualValuatorProps) {
  return (
    <div className="space-y-5 animate-slide-up">
      <div>
        <h2 className="text-2xl font-bold text-terra-text">
          Visual Valuator
        </h2>
        <p className="text-terra-muted text-sm mt-1">
          Optional but improves material analysis accuracy. AI scans for
          cladding type, kitchen grade, and visible condition signals.
        </p>
      </div>

      {/* Upload zones — stacked on mobile, side-by-side on sm+ */}
      <div className="flex flex-col sm:flex-row gap-4">
        <UploadZone
          label="🏠  Property Frontage"
          hint="Front-facing exterior shot"
          file={frontagePhoto}
          onChange={onFrontageChange}
        />
        <UploadZone
          label="🍳  Kitchen"
          hint="Bench, appliances & splashback"
          file={kitchenPhoto}
          onChange={onKitchenChange}
        />
      </div>

      {/* LAWYER_SHIELD §4 — Visual Valuator disclaimer */}
      <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-terra-surface border border-terra-border text-xs text-terra-muted">
        <span className="text-terra-gold flex-shrink-0 text-base mt-0.5">
          🛡️
        </span>
        <p className="leading-relaxed">
          <strong className="text-terra-text">
            Visual Valuator Disclaimer:{" "}
          </strong>
          Material analysis is based on user-provided imagery. Accuracy is
          dependent on photo quality and may not reflect hidden structural
          defects. Photos are processed locally and are not stored on TerraAI
          servers in Phase 1.
        </p>
      </div>
    </div>
  );
}
