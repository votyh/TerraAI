// terraAI-logic-engine.ts

interface PropertyData {
  landArea: number; // From LINZ API
  slopeDegrees: number; // From Topography Layer
  pipeCapacity: 'high' | 'low' | 'none'; // From Council Infrastructure Layer
  zoneType: 'Mixed Housing Urban' | 'Single House' | 'Other'; 
}

export const runAudit = (data: PropertyData) => {
  let score = 0;
  let verdict = "";
  let flags = [];

  // Filter 1: The Physical Potential (Yield)
  if (data.zoneType === 'Mixed Housing Urban' && data.landArea > 600) {
    score += 40; // High potential for multi-unit
  }

  // Filter 2: The Dirt (Slope)
  if (data.slopeDegrees > 15) {
    score -= 20; 
    flags.push("High Slope: Retaining wall costs likely >$150k");
  }

  // Filter 3: The Ghost (Infrastructure)
  if (data.pipeCapacity === 'low') {
    score -= 30;
    flags.push("Infrastructure Fault: Sewer network at 95% capacity");
  }

  // Final Verdict Logic
  if (score > 20) verdict = "GOLD MINE: High Yield Potential";
  else if (score < 0) verdict = "MONEY PIT: High Hidden Costs";
  else verdict = "NEUTRAL: Standard Infill Opportunity";

  return { score, verdict, flags };
}