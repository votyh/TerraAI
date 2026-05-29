import { useState, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const ARCH_LAYERS = [
  {
    label: "CLIENT LAYER", sublabel: "Next.js 16 · App Router · Tailwind CSS · Supabase SSR Auth",
    color: "cyan",
    nodes: ["PropertyDNA Report UI","Real-time Scan Feed (WS)","Supabase Auth SSR","Stripe Billing Portal","Map Viewer (Mapbox GL)","PDF Viewer (react-pdf)"]
  },
  {
    label: "API GATEWAY", sublabel: "FastAPI · Redis Queue · Uvicorn · WebSocket Manager",
    color: "purple",
    nodes: ["Scan Orchestrator","JWT + API Key Auth","Tier Rate Limiter","WebSocket Event Bus","OpenAPI / Swagger","Signed Webhook Dispatch"]
  },
  {
    label: "INTELLIGENCE LAYER", sublabel: "Python Microservices · asyncio · Celery Workers",
    color: "amber",
    nodes: ["GIS Ingestor","Price/SQM Engine","Subdivision Analyzer","Zoning Classifier","Flood Risk Scorer","Sun Path Calculator","Proximity Engine","ML DNA Synthesizer"]
  },
  {
    label: "DATA LAYER", sublabel: "Supabase · PostGIS · Redis Cache · S3 · pgvector",
    color: "green",
    nodes: ["Property Records (PostGIS)","Scan Cache (JSONB)","User & Billing DB","PDF / Report Store (S3)","Vector Embeddings (pgvector)","Audit & Consent Log"]
  },
  {
    label: "EXTERNAL DATA SOURCES", sublabel: "Government APIs · Proprietary Feeds · LiDAR · Satellite",
    color: "slate",
    nodes: ["LINZ Data Service (NZ)","Auckland / WCC GIS","NIWA Flood + Climate","NSW DPIE / Spatial","Google Maps 3D Terrain","CoreLogic / QV","REINZ / REIQ Sales","NZTA Infrastructure"]
  }
];

const PIPELINE_RAW = [
  { n:"01", name:"Geocode + Parcel ID",    ms:3000,  service:"LINZ + Google Geocoding",  desc:"Resolve address → legal parcel, title number, Lot/DP, coordinates." },
  { n:"02", name:"Parallel GIS Ingestion", ms:12000, service:"Council WFS + LINZ API",    desc:"Zoning layers, LiDAR DEM tiles, ARI flood polygons, title & consent records." },
  { n:"03", name:"Zoning Classification",  ms:8000,  service:"Zoning Engine (Python)",   desc:"AUP/NSW zone overlay, development controls, height limits, precinct rules." },
  { n:"04", name:"Price Intelligence",     ms:7000,  service:"Price/SQM Engine",         desc:"Comparable sales pull, $/m² vs suburb P50/P75 benchmark, CV delta calc." },
  { n:"05", name:"Environment Scoring",    ms:6000,  service:"Risk Scorer",               desc:"Flood ARI, LiDAR slope gradient, solar azimuth path, EQC zone, Healthy Homes." },
  { n:"06", name:"Micro-Economics",        ms:8000,  service:"Proximity Engine",          desc:"School zone premium, PT stop score, watermain/sewer proximity, 3-network." },
  { n:"07", name:"DNA Synthesis + ML",     ms:10000, service:"ML Orchestrator",           desc:"Cross-reference 40+ vectors → Property DNA score 0–100 with sub-scores." },
  { n:"08", name:"Report + CDN Delivery",  ms:6000,  service:"Renderer + Supabase CDN",   desc:"PDF generation, Supabase Storage upload, webhook + email trigger." }
];

const TIER_COLORS = {
  slate:  { border:"border-slate-700",  bg:"bg-slate-900",   text:"text-slate-300",  badge:"bg-slate-800 text-slate-300",   dot:"bg-slate-400"   },
  cyan:   { border:"border-cyan-700",   bg:"bg-cyan-950",    text:"text-cyan-400",   badge:"bg-cyan-900 text-cyan-300",     dot:"bg-cyan-400"    },
  purple: { border:"border-purple-700", bg:"bg-purple-950",  text:"text-purple-400", badge:"bg-purple-900 text-purple-300", dot:"bg-purple-400"  },
  amber:  { border:"border-amber-700",  bg:"bg-amber-950",   text:"text-amber-400",  badge:"bg-amber-900 text-amber-300",   dot:"bg-amber-400"   },
  green:  { border:"border-green-700",  bg:"bg-green-950",   text:"text-green-400",  badge:"bg-green-900 text-green-300",   dot:"bg-green-400"   }
};

const TIERS = [
  { id:"T1", name:"Snapshot Report",   price:"$49",   unit:"/report", market:"B2C Home Buyers",      accent:"slate",  arr:"~$49K/mo @ 1,000 scans",
    features:["Property DNA summary","Price/SQM benchmark","Flood risk (ARI level)","Zoning summary","1-page PDF export"] },
  { id:"T2", name:"Deep DNA Scan",     price:"$199",  unit:"/report", market:"B2C Investors",         accent:"cyan",   arr:"~$60K/mo @ 300 scans",
    features:["Full 40-variable DNA","Subdivision feasibility","LiDAR slope analysis","Consent history","School zone premium","Comparable sales + CV delta"] },
  { id:"T3", name:"Pro Subscription",  price:"$499",  unit:"/month",  market:"Agents & Advocates",    accent:"purple", arr:"~$100K/mo @ 200 users",
    features:["50 scans/month","Portfolio tracker","Market alerts","API 500 calls/mo","White-label PDF","Priority queue (<30s)"] },
  { id:"T4", name:"Agency API",        price:"$2,999",unit:"/month",  market:"Proptech Platforms",     accent:"amber",  arr:"~$360K/mo @ 10 clients",
    features:["Unlimited scans","Raw GIS endpoints","Signed webhooks","SLA 99.9%","Batch scan (500/job)","Dedicated engineering support"] },
  { id:"T5", name:"Institutional",     price:"$1M+",  unit:"/year",   market:"Banks · Councils · REITs",accent:"green", arr:"$1M NZD ARR milestone",
    features:["Full data lake access","Custom model training","On-prem deployment","Council GIS integration","Regulatory reporting suite","Co-branded platform"] }
];

const ENDPOINTS = [
  { method:"POST", path:"/v1/scan/property",         tier:"T2+", latency:"<60s",   desc:"Trigger full PropertyDNA scan — returns scan_id + websocket topic." },
  { method:"GET",  path:"/v1/property/{id}/dna",     tier:"T2+", latency:"<100ms", desc:"Fetch cached Property DNA result (40-variable JSON)." },
  { method:"GET",  path:"/v1/property/{id}/price-sqm",tier:"T1+",latency:"<200ms", desc:"Price/SQM vs suburb P25/P50/P75 benchmarks." },
  { method:"GET",  path:"/v1/property/{id}/subdivision",tier:"T2+",latency:"<300ms",desc:"Subdivision feasibility score + minimum lot size delta." },
  { method:"GET",  path:"/v1/property/{id}/flood-risk",tier:"T1+",latency:"<150ms",desc:"ARI flood level, AEP%, FENZ polygon overlay." },
  { method:"GET",  path:"/v1/suburb/{slug}/benchmarks",tier:"T3+",latency:"<500ms",desc:"Full suburb market intelligence: median, $/m², days on market." },
  { method:"POST", path:"/v1/batch/scan",            tier:"T4+", latency:"async",  desc:"Batch trigger up to 500 scans; returns job_id for polling." },
  { method:"GET",  path:"/v1/gis/layers/{region}",   tier:"T5",  latency:"<1s",    desc:"Raw GIS layer export: zoning, flood, topography as GeoJSON." }
];

const METHOD_STYLE = { GET:"bg-green-900 text-green-300", POST:"bg-amber-900 text-amber-300" };
const TIER_TEXT = { "T1+":"text-slate-400","T2+":"text-cyan-400","T3+":"text-purple-400","T4+":"text-amber-400","T5":"text-green-400" };
const PIPE_COLORS = ["bg-cyan-600","bg-purple-600","bg-amber-600","bg-green-600","bg-red-600","bg-orange-600","bg-violet-600","bg-cyan-500"];
const PIPE_TEXT   = ["text-cyan-400","text-purple-400","text-amber-400","text-green-400","text-red-400","text-orange-400","text-violet-400","text-cyan-300"];
const PIPE_BORDER = ["border-cyan-800 bg-cyan-950","border-purple-800 bg-purple-950","border-amber-800 bg-amber-950","border-green-800 bg-green-950","border-red-800 bg-red-950","border-orange-800 bg-orange-950","border-violet-800 bg-violet-950","border-cyan-700 bg-cyan-900"];

const REV_DATA = [
  { tier:"T1", rev:49,  fill:"#94a3b8" },
  { tier:"T2", rev:60,  fill:"#06b6d4" },
  { tier:"T3", rev:100, fill:"#a855f7" },
  { tier:"T4", rev:360, fill:"#f59e0b" },
  { tier:"T5", rev:430, fill:"#22c55e" }
];

export default function TerraAIArchitecture() {
  const [tab, setTab] = useState(0);
  const [hoveredTier, setHoveredTier] = useState(null);
  const [hoveredStep, setHoveredStep] = useState(null);

  const pipeline = useMemo(() => {
    let acc = 0;
    return PIPELINE_RAW.map(s => {
      const start = acc;
      acc += s.ms / 1000;
      return { ...s, startSec: start, endSec: acc };
    });
  }, []);

  const totalSec = pipeline[pipeline.length - 1]?.endSec ?? 60;

  const tabs = ["System Architecture", "60s Pipeline", "Revenue Ladder", "API Strategy"];

  return (
    <div className="bg-slate-950 min-h-screen text-slate-100 p-4 text-xs" style={{ fontFamily:"'JetBrains Mono','Fira Code',monospace" }}>

      {/* ── Header ── */}
      <div className="mb-5 border-b border-slate-800 pb-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-cyan-500 rounded flex items-center justify-center flex-shrink-0">
              <span className="text-slate-950 font-black text-base">T</span>
            </div>
            <div>
              <div className="text-base font-black tracking-widest">
                <span className="text-cyan-400">TERRA</span><span className="text-white">AI</span>
                <span className="text-slate-600 text-xs font-normal ml-3">// SYSTEMS ARCHITECTURE v1.0</span>
              </div>
              <div className="text-slate-500 mt-0.5">NZ/AU Property Intelligence Platform · $1M NZD ARR Target · April 2027</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-cyan-400 mb-0.5">STACK</div>
            <div className="text-slate-400">Next.js 16 · FastAPI · Supabase · Tailwind</div>
          </div>
        </div>
      </div>

      {/* ── Tab Nav ── */}
      <div className="flex flex-wrap gap-1 mb-5">
        {tabs.map((t, i) => (
          <button key={i} onClick={() => setTab(i)}
            className={`px-3 py-1.5 rounded transition-all ${tab === i ? "bg-cyan-500 text-slate-950 font-black" : "text-slate-400 border border-slate-800 hover:border-slate-500 hover:text-slate-200"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════ */}
      {/* TAB 0 – System Architecture               */}
      {/* ══════════════════════════════════════════ */}
      {tab === 0 && (
        <div className="space-y-2.5">
          {ARCH_LAYERS.map((layer, i) => {
            const c = TIER_COLORS[layer.color];
            return (
              <div key={i} className={`border ${c.border} ${c.bg} rounded-lg p-3.5`}>
                <div className="flex items-start justify-between mb-2.5">
                  <div>
                    <span className={`font-black tracking-widest ${c.text}`}>{layer.label}</span>
                    <span className="text-slate-600 ml-3">{layer.sublabel}</span>
                  </div>
                  <div className={`w-2 h-2 rounded-full ${c.dot} mt-1 flex-shrink-0`} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {layer.nodes.map((n, j) => (
                    <span key={j} className={`${c.badge} px-2 py-1 rounded`}>{n}</span>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="border border-slate-800 rounded-lg p-3.5 mt-2">
            <div className="text-slate-500 mb-2.5 tracking-wider font-black">// ARCHITECTURE PRINCIPLES</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                ["Async-first",        "All GIS/API calls run as asyncio.gather() tasks"],
                ["Spatial-native",     "PostGIS for all geographic queries + index"],
                ["Cache-aggressively", "Redis TTL-based scan result caching (24h)"],
                ["Event-driven",       "WebSocket push for real-time 60s scan progress"],
                ["Modular services",   "Each DNA variable = isolated async service"],
                ["Multi-region",       "NZ (ap-southeast-2) + AU (ap-southeast-4)"]
              ].map(([k, v], idx) => (
                <div key={idx}>
                  <span className="text-cyan-400">{k}: </span>
                  <span className="text-slate-400">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* TAB 1 – 60s Pipeline                       */}
      {/* ══════════════════════════════════════════ */}
      {tab === 1 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="text-slate-500">// DEEP NEURAL SCAN · <span className="text-cyan-400 font-black">TARGET: &lt;60s END-TO-END</span></div>
            <div className="text-amber-400 font-black">{totalSec}s TOTAL</div>
          </div>

          {/* Gantt bar */}
          <div className="mb-1 h-7 bg-slate-900 rounded overflow-hidden flex">
            {pipeline.map((step, i) => {
              const w = ((step.ms / 1000) / totalSec) * 100;
              return (
                <div key={i} style={{ width:`${w}%` }}
                  className={`${PIPE_COLORS[i]} border-r border-slate-950 flex items-center justify-center cursor-pointer transition-opacity ${hoveredStep === i ? "opacity-100" : "opacity-60"}`}
                  onMouseEnter={() => setHoveredStep(i)} onMouseLeave={() => setHoveredStep(null)}>
                  <span className="text-white font-black">{step.n}</span>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-slate-600 mb-5">
            {[0, 15, 30, 45, 60].map(t => <span key={t}>{t}s</span>)}
          </div>

          <div className="space-y-2">
            {pipeline.map((step, i) => (
              <div key={i}
                className={`border ${PIPE_BORDER[i]} rounded-lg p-3 cursor-pointer transition-all ${hoveredStep === i ? "opacity-100" : "opacity-75"}`}
                onMouseEnter={() => setHoveredStep(i)} onMouseLeave={() => setHoveredStep(null)}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`font-black ${PIPE_TEXT[i]}`}>{step.n}</span>
                    <div>
                      <span className={`font-black text-sm ${PIPE_TEXT[i]}`}>{step.name}</span>
                      <span className="text-slate-600 ml-2">{step.service}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <div className="text-slate-200 font-black">{step.ms / 1000}s</div>
                    <div className="text-slate-600">{step.startSec.toFixed(1)}→{step.endSec.toFixed(1)}s</div>
                  </div>
                </div>
                <div className="text-slate-500 mt-1.5">{step.desc}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 border border-amber-900 bg-amber-950 rounded-lg">
            <span className="text-amber-400 font-black">⚡ PARALLELISM: </span>
            <span className="text-slate-400">Steps 01–02 sequential (geocode required first). Steps 03–06 run concurrently via <code className="text-amber-300">asyncio.gather()</code>. Steps 07–08 sequential synthesis. Net wall-clock: ~{totalSec}s vs ~120s serial.</span>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* TAB 2 – Revenue Ladder                     */}
      {/* ══════════════════════════════════════════ */}
      {tab === 2 && (
        <div>
          <div className="text-slate-500 mb-4 font-black tracking-wider">// 5-TIER PRODUCT LADDER · NZ/AU MARKET</div>
          <div className="space-y-2.5">
            {TIERS.map((tier, i) => {
              const c = TIER_COLORS[tier.accent];
              const dimmed = hoveredTier !== null && hoveredTier !== i;
              return (
                <div key={i}
                  className={`border ${c.border} ${c.bg} rounded-lg p-4 cursor-pointer transition-all ${dimmed ? "opacity-40" : "opacity-100"}`}
                  onMouseEnter={() => setHoveredTier(i)} onMouseLeave={() => setHoveredTier(null)}>
                  <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <span className={`font-black border ${c.border} px-2 py-0.5 rounded ${c.text}`}>{tier.id}</span>
                      <div>
                        <div className={`font-black text-sm ${c.text}`}>{tier.name}</div>
                        <div className="text-slate-500">{tier.market}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-xl font-black ${c.text}`}>{tier.price}</div>
                      <div className="text-slate-600">{tier.unit}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {tier.features.map((f, j) => (
                      <span key={j} className={`${c.badge} px-2 py-0.5 rounded`}>{f}</span>
                    ))}
                  </div>
                  <div className="border-t border-slate-800 pt-2 flex items-center justify-between">
                    <span className="text-slate-600">Revenue potential</span>
                    <span className={`font-black ${c.text}`}>{tier.arr}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Revenue chart */}
          <div className="mt-4 p-4 border border-slate-800 bg-slate-900 rounded-lg">
            <div className="text-slate-500 mb-3 font-black">// MONTHLY REVENUE STACK TO $1M NZD ARR</div>
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={REV_DATA} margin={{ top:4, right:4, left:4, bottom:4 }}>
                  <XAxis dataKey="tier" tick={{ fill:"#64748b", fontSize:11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill:"#64748b", fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}K`} />
                  <Tooltip contentStyle={{ background:"#0f172a", border:"1px solid #334155", borderRadius:4, fontSize:11 }}
                    labelStyle={{ color:"#94a3b8" }} formatter={v => [`$${v}K NZD/mo`,"Revenue"]} />
                  <Bar dataKey="rev" radius={[3,3,0,0]}>
                    {REV_DATA.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="text-slate-600 text-right mt-1">Total at scale: ~$1,000K NZD/mo</div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* TAB 3 – API Strategy                       */}
      {/* ══════════════════════════════════════════ */}
      {tab === 3 && (
        <div>
          <div className="text-slate-500 mb-4 font-black tracking-wider">// REST API · VERSIONED AT /v1/ · WebSocket for live scan progress</div>

          <div className="space-y-2 mb-5">
            {ENDPOINTS.map((ep, i) => (
              <div key={i} className="border border-slate-800 bg-slate-900 rounded-lg p-3 hover:border-slate-600 transition-colors">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className={`font-black px-2 py-0.5 rounded ${METHOD_STYLE[ep.method]}`}>{ep.method}</span>
                  <code className="text-slate-200 flex-1">{ep.path}</code>
                  <span className={`font-black ${TIER_TEXT[ep.tier]}`}>{ep.tier}</span>
                  <span className="text-slate-600 border border-slate-700 px-2 py-0.5 rounded">{ep.latency}</span>
                </div>
                <div className="text-slate-500">{ep.desc}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 mb-4">
            {[
              { title:"Auth Strategy",   detail:"JWT (Supabase) for T1–T3. API Key + HMAC-SHA256 for T4–T5. Refresh token rotation.",        color:"cyan"   },
              { title:"Rate Limiting",   detail:"Redis sliding window per API key. Tier-enforced: T1=10/hr, T3=500/mo, T4=unlimited.",        color:"purple" },
              { title:"Versioning",      detail:"Header X-TerraAI-Version. /v1/ stable, /v2/ preview. 12-month deprecation notice policy.",  color:"amber"  },
              { title:"Webhooks (T4+)",  detail:"HMAC-SHA256 signed payloads. 3x retry with exponential backoff. Dead letter queue via SQS.", color:"green"  }
            ].map((item, i) => {
              const c = TIER_COLORS[item.color];
              return (
                <div key={i} className={`border ${c.border} ${c.bg} rounded-lg p-3`}>
                  <div className={`font-black mb-1 ${c.text}`}>{item.title}</div>
                  <div className="text-slate-400">{item.detail}</div>
                </div>
              );
            })}
          </div>

          <div className="p-3.5 border border-cyan-900 bg-cyan-950 rounded-lg">
            <div className="text-cyan-400 font-black mb-2">// SCALING PATH: $49 REPORT → $1M INSTITUTIONAL</div>
            <div className="text-slate-400 space-y-1">
              {[
                "1.  Launch T1/T2 B2C — validate pipeline accuracy, brand, and NPS in NZ market",
                "2.  Convert high-volume T2 buyers → T3 Pro subscription (better unit economics)",
                "3.  White-label T3 API to NZ/AU proptech platforms → T4 Agency contracts",
                "4.  Council + Bank data partnerships + regulatory reporting → T5 Institutional",
                "5.  AU expansion via NSW DPIE integration → doubles total addressable market"
              ].map((s, i) => <div key={i}>{s}</div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
