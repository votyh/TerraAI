"use client";

import { useEffect, useRef, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";

/* ── Supabase client (reads NEXT_PUBLIC_ env vars) ────────────────────────── */
const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "";
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const supabase = (supabaseUrl && supabaseAnon)
  ? createClient(supabaseUrl, supabaseAnon)
  : null;

/* ── Inline: address search bar ───────────────────────────────────────────── */
function AddressSearch({ onSubmit }: { onSubmit: (addr: string) => void }) {
  const [val, setVal] = useState("");
  const [focused, setFocused] = useState(false);
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (val.trim()) onSubmit(val.trim()); };
  return (
    <form onSubmit={submit} className="relative w-full">
      <div
        className="flex items-center rounded-2xl h-[72px] transition-all duration-500"
        style={{
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(20px)",
          border: `1px solid ${focused ? "hsl(162 90% 45% / 0.6)" : "hsl(0 0% 100% / 0.08)"}`,
          boxShadow: focused
            ? "0 0 0 4px hsl(162 90% 45% / 0.08), 0 0 60px hsl(162 90% 45% / 0.25)"
            : "0 20px 60px -20px rgba(0,0,0,0.8)",
        }}
      >
        <div className="pl-5 pr-3">
          <svg className="h-5 w-5" style={{ color: focused ? "hsl(162 90% 45%)" : "hsl(0 0% 60%)" }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
        </div>
        <input
          type="text"
          placeholder="Enter any address…"
          value={val}
          onChange={e => setVal(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="flex-1 bg-transparent outline-none text-lg font-light"
          style={{ color: "hsl(0 0% 96%)" }}
        />
        <button
          type="submit"
          className="mr-2 flex items-center gap-2 rounded-xl px-5 h-14 font-mono-tech text-[11px] tracking-widest uppercase transition-transform active:scale-[0.98]"
          style={{
            background: "linear-gradient(135deg, hsl(162 90% 45%), hsl(188 95% 55%))",
            color: "hsl(0 0% 4%)",
            boxShadow: "0 0 30px hsl(162 90% 45% / 0.5), 0 0 60px hsl(162 90% 45% / 0.2)",
          }}
        >
          ANALYZE MY EQUITY
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
        </button>
      </div>
    </form>
  );
}

/* ── Inline: DNA factor bar ───────────────────────────────────────────────── */
function DnaBar({
  code, label, value, delta, detail, positive = true, delay = 0,
}: {
  code: string; label: string; value: number; delta: string;
  detail?: string; positive?: boolean; delay?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), delay + 200); return () => clearTimeout(t); }, [delay]);
  const color = positive ? "hsl(162 90% 45%)" : "hsl(0 80% 55%)";
  return (
    <div className="space-y-2 cursor-pointer" onClick={() => detail && setExpanded(e => !e)}>
      <div className="flex items-center justify-between" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase" }}>
        <span style={{ color: "hsl(0 0% 60%)" }}>{code} · {label}</span>
        <span style={{ color }}>{delta}</span>
      </div>
      <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(0 0% 100% / 0.06)" }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: mounted ? `${value}%` : "0%",
            background: `linear-gradient(90deg, ${color}, ${positive ? "hsl(188 95% 55%)" : "hsl(15 90% 55%)"})`,
            boxShadow: `0 0 12px ${color.replace(")", " / 0.5)")}`,
            transitionDelay: `${delay}ms`,
          }}
        />
      </div>
      {expanded && detail && (
        <p className="text-sm font-light mt-2 leading-relaxed" style={{ color: "hsl(0 0% 60%)", fontFamily: "Inter, sans-serif" }}>
          {detail}
        </p>
      )}
    </div>
  );
}

/* ── Inline: auth modal ───────────────────────────────────────────────────── */
function AuthModal({
  open, onClose, address,
}: {
  open: boolean; onClose: () => void; address: string;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const configured = !!(supabaseUrl && supabaseAnon);

  const goApp = () => {
    onClose();
    const dest = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:5173";
    window.location.href = `${dest}/app${address ? `?address=${encodeURIComponent(address)}` : ""}`;
  };

  const handleAuth = async () => {
    setErr("");
    if (!configured) { setErr("Auth not configured — set NEXT_PUBLIC_SUPABASE_URL in .env.local"); return; }
    if (!email || !password) { setErr("Email and password required"); return; }
    if (!supabase) return;
    setBusy(true);
    try {
      const { error } =
        mode === "signin"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });
      if (error) throw error;
      goApp();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    if (!configured || !supabase) { setErr("Auth not configured"); return; }
    const dest = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:5173";
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${dest}/app${address ? `?address=${encodeURIComponent(address)}` : ""}` },
    });
  };

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-[440px] rounded-3xl overflow-hidden"
        style={{
          background: "hsl(0 0% 4% / 0.95)",
          border: "1px solid hsl(0 0% 100% / 0.08)",
          boxShadow: "0 0 80px hsl(162 90% 45% / 0.08), 0 40px 80px rgba(0,0,0,0.6)",
        }}
      >
        <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, hsl(162 90% 45% / 0.5), transparent)" }} />

        <div className="p-8 sm:p-10">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2 font-mono-tech" style={{ color: "hsl(0 0% 60%)", fontSize: 10, letterSpacing: "0.14em" }}>
              <svg className="h-3 w-3" fill="none" stroke="hsl(162 90% 45%)" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
              Secure Vault · 256-BIT
            </div>
            <button onClick={onClose} style={{ color: "hsl(0 0% 40%)" }} className="hover:text-white transition-colors text-xl leading-none">&times;</button>
          </div>

          <h2 className="font-serif-display text-3xl mb-2" style={{ color: "hsl(0 0% 96%)" }}>
            {mode === "signin" ? "Enter the Vault" : "Request Access"}
          </h2>
          <p className="text-sm mb-6 font-light" style={{ color: "hsl(0 0% 60%)" }}>
            {mode === "signin" ? "Access your Asset Audit reports." : "Create an account to run your first Comprehensive Asset Audit."}
          </p>

          {err && (
            <div className="mb-4 px-4 py-3 rounded-xl text-sm font-light" style={{ background: "hsl(0 70% 50% / 0.12)", border: "1px solid hsl(0 70% 50% / 0.3)", color: "hsl(0 80% 70%)" }}>
              {err}
            </div>
          )}

          <div className="space-y-3">
            <div className="relative">
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4" fill="none" stroke="hsl(0 0% 40%)" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
              <input type="email" placeholder="you@domain.com" value={email} disabled={busy}
                onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && void handleAuth()}
                className="w-full h-12 rounded-xl pl-11 pr-4 text-sm outline-none transition-all disabled:opacity-50"
                style={{ background: "hsl(0 0% 100% / 0.03)", border: "1px solid hsl(0 0% 100% / 0.1)", color: "hsl(0 0% 96%)" }} />
            </div>
            <div className="relative">
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4" fill="none" stroke="hsl(0 0% 40%)" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
              <input type="password" placeholder="Password" value={password} disabled={busy}
                onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && void handleAuth()}
                className="w-full h-12 rounded-xl pl-11 pr-4 text-sm outline-none transition-all disabled:opacity-50"
                style={{ background: "hsl(0 0% 100% / 0.03)", border: "1px solid hsl(0 0% 100% / 0.1)", color: "hsl(0 0% 96%)" }} />
            </div>
            <button disabled={busy} onClick={() => void handleAuth()}
              className="w-full h-12 rounded-xl font-mono-tech tracking-widest uppercase transition-transform active:scale-[0.99] disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, hsl(162 90% 45%), hsl(188 95% 55%))", color: "hsl(0 0% 4%)", boxShadow: "0 0 30px hsl(162 90% 45% / 0.35)", fontSize: 11 }}>
              {busy ? "Authenticating…" : mode === "signin" ? "Authenticate" : "Create Account"}
            </button>
            <div className="flex items-center gap-3 py-2">
              <div className="h-px flex-1" style={{ background: "hsl(0 0% 100% / 0.1)" }} />
              <span className="font-mono-tech" style={{ color: "hsl(0 0% 40%)", fontSize: 10 }}>OR</span>
              <div className="h-px flex-1" style={{ background: "hsl(0 0% 100% / 0.1)" }} />
            </div>
            <button disabled={busy} onClick={() => void handleGoogle()}
              className="w-full h-12 rounded-xl text-sm font-medium flex items-center justify-center gap-3 transition-colors disabled:opacity-60"
              style={{ background: "hsl(0 0% 100% / 0.02)", border: "1px solid hsl(0 0% 100% / 0.1)", color: "hsl(0 0% 96%)" }}>
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path fill="currentColor" d="M21.35 11.1h-9.18v2.92h5.27c-.23 1.46-1.7 4.28-5.27 4.28a5.78 5.78 0 1 1 0-11.56 5.18 5.18 0 0 1 3.66 1.43l2.5-2.42A8.74 8.74 0 0 0 12.17 3a9 9 0 1 0 0 18c5.2 0 8.65-3.65 8.65-8.79 0-.59-.06-1.04-.13-1.5z"/>
              </svg>
              Continue with Google
            </button>
          </div>

          <button onClick={() => setMode(m => m === "signin" ? "signup" : "signin")}
            className="mt-5 w-full text-center text-xs transition-colors" style={{ color: "hsl(0 0% 40%)" }}>
            {mode === "signin" ? "No account? " : "Already a member? "}
            <span style={{ color: "hsl(162 90% 45%)" }}>{mode === "signin" ? "Request access" : "Sign in"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main landing page ────────────────────────────────────────────────────── */
export default function HomePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authAddress, setAuthAddress] = useState("");
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const [demoFlood, setDemoFlood] = useState<"None" | "Low" | "Medium" | "High">("None");
  const [scrollPct, setScrollPct] = useState(0);
  const [cursor, setCursor] = useState({ x: -999, y: -999 });
  const topoRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const [statsLive, setStatsLive] = useState(false);

  /* ── Auth session ── */
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  /* ── Cursor parallax + scroll ── */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      setCursor({ x: e.clientX, y: e.clientY });
      if (!topoRef.current) return;
      const x = (e.clientX / window.innerWidth - 0.5) * 14;
      const y = (e.clientY / window.innerHeight - 0.5) * 14;
      topoRef.current.style.transform = `translate3d(${x}px,${y}px,0)`;
    };
    const onScroll = () => {
      const d = document.documentElement;
      setScrollPct(d.scrollTop / Math.max(1, d.scrollHeight - d.clientHeight));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("scroll", onScroll); };
  }, []);

  /* ── Stats counter reveal ── */
  useEffect(() => {
    const el = statsRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setStatsLive(true); }, { threshold: 0.2 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /* ── Scroll-triggered reveal ── */
  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add("is-visible"); }),
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );
    document.querySelectorAll(".reveal").forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:5173";

  const handleAddress = (addr: string) => {
    if (session) {
      window.location.href = `${appUrl}/app?address=${encodeURIComponent(addr)}`;
    } else {
      setAuthAddress(addr);
      setAuthOpen(true);
    }
  };

  const goApp = () => { window.location.href = `${appUrl}/app`; };

  const FLOOD_DEMO: Record<string, { value: number; delta: string; positive: boolean }> = {
    None:   { value: 95, delta: "UNAFFECTED", positive: true  },
    Low:    { value: 70, delta: "− $9,700",   positive: false },
    Medium: { value: 42, delta: "− $19,400",  positive: false },
    High:   { value: 18, delta: "− $38,800",  positive: false },
  };
  const flood = FLOOD_DEMO[demoFlood];

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: "#050505", color: "hsl(0 0% 96%)" }}>
      {/* ── Cursor glow ── */}
      <div aria-hidden className="pointer-events-none fixed z-[9998] rounded-full"
        style={{
          left: cursor.x, top: cursor.y, transform: "translate(-50%,-50%)",
          width: 360, height: 360,
          background: "radial-gradient(circle, hsl(162 90% 45% / 0.09) 0%, hsl(188 95% 55% / 0.04) 40%, transparent 70%)",
          transition: "left 0.07s ease-out, top 0.07s ease-out",
        }}
      />

      {/* ── NAV ── */}
      <header className="fixed top-0 inset-x-0 z-40">
        <div className="container flex items-center justify-between py-4 max-w-7xl mx-auto px-6">
          <a href="#" className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/terraai-icon.png" alt="TerraAI" width={32} height={32} className="h-8 w-8 rounded-md" />
            <span className="font-serif-display text-xl silver-text">TerraAI</span>
          </a>
          <nav className="hidden md:flex items-center gap-8 font-mono-tech" style={{ color: "hsl(0 0% 60%)", fontSize: 11, letterSpacing: "0.14em" }}>
            <a href="#dna" className="hover:text-white transition-colors">Analysis</a>
            <a href="#trust" className="hover:text-white transition-colors">Trust</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
          </nav>
          <button
            onClick={() => { if (session) { goApp(); } else { setAuthAddress(""); setAuthOpen(true); } }}
            className="h-10 px-5 rounded-full font-mono-tech transition-all"
            style={{ border: "1px solid hsl(0 0% 100% / 0.1)", background: "hsl(0 0% 100% / 0.02)", color: "hsl(0 0% 96%)", fontSize: 11, letterSpacing: "0.14em" }}
          >
            <span className="flex items-center gap-2">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
              {session ? "Dashboard" : "Sign In"}
            </span>
          </button>
        </div>
        <div className="relative h-px" style={{ background: "hsl(0 0% 100% / 0.06)" }}>
          <div className="absolute inset-y-0 left-0 transition-all"
            style={{ width: `${scrollPct * 100}%`, background: "linear-gradient(90deg, hsl(162 90% 45%), hsl(188 95% 55%))", boxShadow: "0 0 8px hsl(162 90% 45% / 0.8)" }} />
        </div>
      </header>

      {/* ── HERO ── */}
      <section className="relative pt-36 sm:pt-44 pb-24 sm:pb-32">
        <div className="absolute inset-0 grid-bg" aria-hidden />
        <div ref={topoRef} className="absolute right-0 top-0 w-[600px] max-w-[60vw] opacity-20 pointer-events-none select-none" aria-hidden
          style={{ transition: "transform 0.3s ease-out" }}>
          <svg viewBox="0 0 600 700" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
            {[0.08,0.06,0.05,0.04,0.03].map((op, i) => (
              <ellipse key={i} cx="400" cy="350" rx={180 + i*60} ry={220 + i*70}
                stroke="hsl(162 90% 45%)" strokeWidth="1" opacity={op} transform={`rotate(${i*12} 400 350)`} />
            ))}
            {[0.1,0.07,0.05,0.04,0.03].map((op, i) => (
              <ellipse key={`b${i}`} cx="320" cy="280" rx={120 + i*50} ry={160 + i*60}
                stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity={op} transform={`rotate(${-i*9} 320 280)`} />
            ))}
          </svg>
        </div>

        <div className="container relative max-w-7xl mx-auto px-6">
          <div className="mx-auto max-w-3xl text-center space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center gap-3 rounded-full px-4 py-1.5 font-mono-tech reveal"
              style={{ border: "1px solid hsl(0 0% 100% / 0.1)", background: "hsl(0 0% 100% / 0.02)", backdropFilter: "blur(12px)", color: "hsl(0 0% 60%)", fontSize: 10, letterSpacing: "0.18em", opacity: 0, transform: "scale(0.9)", transition: "opacity 0.65s cubic-bezier(0.22,1,0.36,1), transform 0.65s cubic-bezier(0.22,1,0.36,1)" }}>
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full animate-ping" style={{ background: "hsl(162 90% 45%)", opacity: 0.75 }} />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "hsl(162 90% 45%)" }} />
              </span>
              Live Market Position
            </div>

            {/* Title */}
            <h1 className="font-serif-display text-[44px] sm:text-7xl md:text-8xl leading-[0.95] tracking-tight reveal"
              style={{ opacity: 0, transform: "scale(0.84) translateY(28px)", transition: "opacity 0.85s cubic-bezier(0.22,1,0.36,1) 80ms, transform 0.85s cubic-bezier(0.22,1,0.36,1) 80ms" }}>
              The Standard in Property&nbsp;<span className="silver-text">Intelligence.</span>
            </h1>

            <p className="text-base sm:text-lg font-light max-w-xl mx-auto reveal"
              style={{ color: "hsl(0 0% 60%)", opacity: 0, transform: "scale(0.84) translateY(28px)", transition: "opacity 0.85s cubic-bezier(0.22,1,0.36,1) 200ms, transform 0.85s cubic-bezier(0.22,1,0.36,1) 200ms" }}>
              Institutional-grade valuation for the modern homeowner. Access precision data on equity, zoning, and future-proof risk assessments.
            </p>

            <p className="font-mono-tech reveal"
              style={{ color: "hsl(0 0% 40%)", fontSize: 11, letterSpacing: "0.14em", opacity: 0, transform: "scale(0.84) translateY(28px)", transition: "opacity 0.85s cubic-bezier(0.22,1,0.36,1) 280ms, transform 0.85s cubic-bezier(0.22,1,0.36,1) 280ms" }}>
              Rental estimate included
            </p>

            <div className="pt-4 reveal"
              style={{ opacity: 0, transform: "scale(0.84) translateY(28px)", transition: "opacity 0.85s cubic-bezier(0.22,1,0.36,1) 340ms, transform 0.85s cubic-bezier(0.22,1,0.36,1) 340ms" }}>
              <AddressSearch onSubmit={handleAddress} />
              <div className="mt-3 flex items-center justify-center gap-6 font-mono-tech" style={{ color: "hsl(0 0% 50%)", fontSize: 10, letterSpacing: "0.18em" }}>
                <span>NZ · TradeMe</span>
                <span className="h-1 w-1 rounded-full" style={{ background: "hsl(0 0% 20%)" }} />
                <span>AU · RealEstate.com.au</span>
              </div>
            </div>
          </div>

          {/* Stats ticker */}
          <div ref={statsRef} className="mt-16 sm:mt-20 mx-auto max-w-4xl grid grid-cols-2 sm:grid-cols-4 gap-px overflow-hidden rounded-2xl glass-pane silver-border">
            {[["12.4M","Parcels Indexed"],["2.4%","Sunlight Δ Value"],["180ms","Avg. Analysis Time"],["±1.8%","Estimate Variance"]].map(([val, lbl], i) => (
              <div key={lbl} className="px-5 py-6 text-center"
                style={{ background: "rgba(0,0,0,0.4)", opacity: statsLive ? 1 : 0, transform: statsLive ? "translateY(0) scale(1)" : "translateY(20px) scale(0.96)", transition: `opacity 0.7s ease ${i*130}ms, transform 0.7s cubic-bezier(0.22,1,0.36,1) ${i*130}ms` }}>
                <div className="font-serif-display text-2xl sm:text-3xl silver-text">{val}</div>
                <div className="mt-1 font-mono-tech" style={{ color: "hsl(0 0% 60%)", fontSize: 10, letterSpacing: "0.14em" }}>{lbl}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── DNA SECTION ── */}
      <section id="dna" className="relative py-24 sm:py-32">
        <div className="container max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
            <div className="space-y-10 reveal" style={{ opacity:0, transform:"scale(0.84) translateY(28px)", transition:"opacity 0.85s cubic-bezier(0.22,1,0.36,1), transform 0.85s cubic-bezier(0.22,1,0.36,1)" }}>
              <div className="space-y-4">
                <div className="font-mono-tech" style={{ color: "hsl(0 0% 60%)", fontSize: 10, letterSpacing: "0.18em" }}>› Value Drivers · Live Read</div>
                <h2 className="font-serif-display text-4xl sm:text-5xl leading-tight">Three invisible forces<br/>that move every dollar.</h2>
                <p className="font-light max-w-md" style={{ color: "hsl(0 0% 60%)" }}>
                  TerraAI quantifies environmental and social variables that traditional appraisals overlook — and shows you exactly how each one shifts the price.
                </p>
              </div>

              <div className="space-y-7">
                <DnaBar code="01 · RSK" label="Flood & Overland Risk" value={flood.value} delta={flood.delta} positive={flood.positive}
                  detail="GIS overlay of 2025 revised LiDAR elevation data and council stormwater network mapping identifies flood exposure." delay={0} />
                <DnaBar code="02 · EDU" label="School Zone Premium" value={82} delta="+ $58,900"
                  detail="Subject falls within a Decile 9–10 school catchment. Seven consecutive quarters of +4.1% median premium vs. comparable properties." delay={200} />
                <DnaBar code="03 · SUN" label="Sunlight Audit" value={67} delta="+ $34,200"
                  detail="TerraAI measures solar access via LiDAR cadastral orientation modelling. North-facing living areas receive up to 6.2 peak sun hours per day." delay={400} />
              </div>

              {/* Live flood demo */}
              <div className="rounded-2xl p-5 space-y-4" style={{ border: "1px solid hsl(0 0% 100% / 0.1)", background: "hsl(0 0% 100% / 0.015)" }}>
                <div className="flex items-center gap-2.5 font-mono-tech" style={{ color: "hsl(0 0% 60%)", fontSize: 10, letterSpacing: "0.18em" }}>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full animate-ping" style={{ background: "hsl(162 90% 45%)", opacity: 0.75 }} />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "hsl(162 90% 45%)" }} />
                  </span>
                  › Live Demo — Adjust Flood Risk
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["None","Low","Medium","High"] as const).map(risk => {
                    const active = demoFlood === risk;
                    const activeColor = risk === "None" ? "hsl(162 90% 45%)" : risk === "Low" ? "hsl(50 90% 55%)" : risk === "Medium" ? "hsl(25 90% 55%)" : "hsl(0 80% 55%)";
                    return (
                      <button key={risk} onClick={() => setDemoFlood(risk)}
                        className="flex items-center gap-2 px-4 py-2 rounded-full font-mono-tech transition-all"
                        style={{
                          border: `1px solid ${active ? `${activeColor}60` : "hsl(0 0% 100% / 0.1)"}`,
                          background: active ? `${activeColor}18` : "transparent",
                          color: active ? activeColor : "hsl(0 0% 60%)",
                          fontSize: 10, letterSpacing: "0.14em",
                        }}>
                        {risk}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button onClick={goApp} className="inline-flex items-center gap-3 font-mono-tech transition-all" style={{ color: "hsl(162 90% 45%)", fontSize: 11, letterSpacing: "0.14em" }}>
                  Run a Comprehensive Asset Audit
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </button>
            </div>

            {/* Property preview card */}
            <div className="relative rounded-3xl overflow-hidden glass-pane silver-border reveal"
              style={{ opacity:0, transform:"scale(0.84) translateY(28px)", transition:"opacity 0.85s cubic-bezier(0.22,1,0.36,1) 150ms, transform 0.85s cubic-bezier(0.22,1,0.36,1) 150ms", aspectRatio:"4/5" }}>
              <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, hsl(0 0% 6%) 0%, hsl(0 0% 3%) 100%)" }} />
              <div className="absolute inset-0 grid-bg opacity-30" />
              <div className="absolute inset-0 grid place-items-center">
                <div className="relative h-40 w-40">
                  <div className="absolute inset-0 rounded-full" style={{ border: "1px solid hsl(162 90% 45% / 0.4)", animation: "pulseGlow 2.4s ease-in-out infinite" }} />
                  <div className="absolute inset-4 rounded-full" style={{ border: "1px solid hsl(162 90% 45% / 0.2)" }} />
                  <div className="absolute inset-0 grid place-items-center">
                    <svg className="h-6 w-6" fill="none" stroke="hsl(162 90% 45%)" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                    </svg>
                  </div>
                </div>
              </div>
              <div className="absolute top-4 left-4 rounded-full px-3 py-1.5 font-mono-tech" style={{ background: "rgba(0,0,0,0.7)", border: "1px solid hsl(0 0% 100% / 0.1)", color: "hsl(0 0% 60%)", backdropFilter: "blur(12px)", fontSize: 10, letterSpacing: "0.14em" }}>
                42 Coromandel St · Wellington
              </div>
              <div className="absolute bottom-4 inset-x-4 rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: "rgba(0,0,0,0.7)", border: "1px solid hsl(0 0% 100% / 0.1)", backdropFilter: "blur(12px)" }}>
                <div>
                  <div className="font-mono-tech" style={{ color: "hsl(162 90% 45%)", fontSize: 10, letterSpacing: "0.14em" }}>Live Market Position</div>
                  <div className="font-serif-display text-xl">$1.24M – $1.38M</div>
                </div>
                <button onClick={goApp} className="font-mono-tech flex items-center gap-1.5" style={{ color: "hsl(162 90% 45%)", fontSize: 11, letterSpacing: "0.14em" }}>
                  Unlock
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TRUST ── */}
      <section id="trust" className="relative py-20 sm:py-28">
        <div className="container max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto space-y-3 mb-14 reveal" style={{ opacity:0, transform:"scale(0.84) translateY(28px)", transition:"opacity 0.85s cubic-bezier(0.22,1,0.36,1), transform 0.85s cubic-bezier(0.22,1,0.36,1)" }}>
            <div className="font-mono-tech" style={{ color: "hsl(0 0% 60%)", fontSize: 10, letterSpacing: "0.18em" }}>› Trust Cluster</div>
            <h2 className="font-serif-display text-4xl sm:text-5xl">Built on defensible data.</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { n:"01", title:"Asynchronous GIS Analysis", desc:"Parallelized parcel-level geospatial inference across 12.4M titles." },
              { n:"02", title:"2026 Insurance Risk Modeling", desc:"Live floodplain & overland flow path data, mapped to insurer schedules." },
              { n:"03", title:"Proprietary Equity Multipliers", desc:"Region-tuned coefficients for sunlight, school zones and microclimates." },
            ].map(({ n, title, desc }, i) => (
              <div key={title} className="relative rounded-2xl glass-pane silver-border p-7 reveal"
                style={{ opacity:0, transform:"scale(0.84) translateY(28px)", transition:`opacity 0.85s cubic-bezier(0.22,1,0.36,1) ${i*120}ms, transform 0.85s cubic-bezier(0.22,1,0.36,1) ${i*120}ms` }}>
                <div className="flex items-center justify-center h-12 w-12 rounded-xl mb-5" style={{ background: "hsl(162 90% 45% / 0.1)", border: "1px solid hsl(162 90% 45% / 0.2)" }}>
                  <svg className="h-5 w-5" fill="none" stroke="hsl(162 90% 45%)" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                  </svg>
                </div>
                <h3 className="font-serif-display text-xl mb-2">{title}</h3>
                <p className="text-sm font-light" style={{ color: "hsl(0 0% 60%)" }}>{desc}</p>
                <div className="absolute top-4 right-4 font-mono-tech" style={{ color: "hsl(0 0% 25%)", fontSize: 10, letterSpacing: "0.14em" }}>{n}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" className="relative py-24 sm:py-32">
        <div className="container max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto space-y-4 mb-14">
            <div className="font-mono-tech" style={{ color: "hsl(0 0% 60%)", fontSize: 10, letterSpacing: "0.18em" }}>› Intelligence Tiers</div>
            <h2 className="font-serif-display text-4xl sm:text-6xl leading-tight">Two products.<br/>One unfair advantage.</h2>
            <div className="inline-flex rounded-full p-1 mt-4" style={{ border: "1px solid hsl(0 0% 100% / 0.1)", background: "hsl(0 0% 100% / 0.02)" }}>
              {(["monthly","annual"] as const).map(b => (
                <button key={b} onClick={() => setBilling(b)}
                  className="px-4 py-1.5 rounded-full font-mono-tech transition-all"
                  style={{ background: billing === b ? "hsl(0 0% 100% / 0.1)" : "transparent", color: billing === b ? "hsl(0 0% 96%)" : "hsl(0 0% 60%)", fontSize: 10, letterSpacing: "0.14em" }}>
                  {b === "monthly" ? "Monthly" : "Annual − 2mo"}
                </button>
              ))}
            </div>
          </div>
          <div className="grid lg:grid-cols-2 gap-6 max-w-5xl mx-auto">
            <div className="relative rounded-3xl glass-pane silver-border p-8 sm:p-10 flex flex-col">
              <div className="font-mono-tech" style={{ color: "hsl(0 0% 60%)", fontSize: 10, letterSpacing: "0.14em" }}>Tier 01 · B2C</div>
              <h3 className="mt-3 font-serif-display text-3xl">Home Health Check</h3>
              <div className="mt-7 flex items-baseline gap-2">
                <span className="font-serif-display text-6xl silver-text">$49</span>
                <span className="font-mono-tech" style={{ color: "hsl(0 0% 60%)", fontSize: 11 }}>/ report</span>
              </div>
              <ul className="mt-7 space-y-3.5 text-sm flex-1">
                {["Proprietary Sunlight Audit · 2.4% shift logic","2026 Hazard Assessment · floodplains & overland","Prime school zone & cost-per-sqm baselines","Consultant Brief in plain English","Printable Comprehensive Asset Audit certificate"].map(f => (
                  <li key={f} className="flex items-start gap-3">
                    <svg className="h-4 w-4 mt-0.5 shrink-0" fill="none" stroke="hsl(162 90% 45%)" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    <span style={{ color: "hsl(0 0% 80%)" }}>{f}</span>
                  </li>
                ))}
              </ul>
              <button onClick={goApp} className="mt-8 py-4 rounded-2xl font-mono-tech flex items-center justify-center gap-2 transition-colors"
                style={{ border: "1px solid hsl(0 0% 100% / 0.15)", background: "hsl(0 0% 100% / 0.03)", color: "hsl(0 0% 96%)", fontSize: 11, letterSpacing: "0.14em" }}>
                Generate Report
              </button>
            </div>
            <div className="relative rounded-3xl p-[1px]" style={{ background: "linear-gradient(135deg, hsl(162 90% 45% / 0.6), hsl(188 95% 55% / 0.4) 50%, hsl(0 0% 30%))" }}>
              <div className="relative rounded-[calc(1.5rem-1px)] p-8 sm:p-10 flex flex-col h-full overflow-hidden" style={{ background: "#050505" }}>
                <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full pointer-events-none" style={{ background: "hsl(162 90% 45% / 0.1)", filter: "blur(48px)" }} />
                <div className="flex items-center justify-between">
                  <div className="font-mono-tech" style={{ color: "hsl(162 90% 45%)", fontSize: 10, letterSpacing: "0.14em" }}>Tier 02 · B2B SaaS</div>
                  <span className="font-mono-tech px-2 py-1 rounded-full" style={{ border: "1px solid hsl(162 90% 45% / 0.4)", color: "hsl(162 90% 45%)", background: "hsl(162 90% 45% / 0.05)", fontSize: 9 }}>MOST POWERFUL</span>
                </div>
                <h3 className="mt-3 font-serif-display text-3xl">Listing Accelerator</h3>
                <div className="mt-7 flex items-baseline gap-2">
                  <span className="font-serif-display text-6xl silver-text">${billing === "monthly" ? "499" : "415"}</span>
                  <span className="font-mono-tech" style={{ color: "hsl(0 0% 60%)", fontSize: 11 }}>/ branch / mo</span>
                </div>
                <ul className="mt-7 space-y-3.5 text-sm flex-1">
                  {["Embedded AI widget on agency site","Lead Capture Engine · seller contact + intent","Full brand customization (Ray White, McGrath…)","Agent intelligence dashboard · suburb heatmaps","Bulk API · portfolio-wide undervalued asset scan"].map(f => (
                    <li key={f} className="flex items-start gap-3">
                      <svg className="h-4 w-4 mt-0.5 shrink-0" fill="none" stroke="hsl(162 90% 45%)" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      <span style={{ color: "hsl(0 0% 90%)" }}>{f}</span>
                    </li>
                  ))}
                </ul>
                <button onClick={goApp} className="mt-8 py-4 rounded-2xl font-mono-tech flex items-center justify-center gap-2 transition-transform active:scale-[0.99]"
                  style={{ background: "linear-gradient(135deg, hsl(162 90% 45%), hsl(188 95% 55%))", color: "hsl(0 0% 4%)", boxShadow: "0 0 40px hsl(162 90% 45% / 0.35)", fontSize: 11, letterSpacing: "0.14em" }}>
                  Request a Demo
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA FOOTER ── */}
      <section className="relative py-24 sm:py-32">
        <div className="container max-w-7xl mx-auto px-6">
          <div className="relative mx-auto max-w-4xl rounded-3xl glass-pane silver-border p-10 sm:p-16 text-center overflow-hidden reveal"
            style={{ opacity:0, transform:"scale(0.84) translateY(28px)", transition:"opacity 0.85s cubic-bezier(0.22,1,0.36,1), transform 0.85s cubic-bezier(0.22,1,0.36,1)" }}>
            <div className="absolute -top-20 left-1/2 -translate-x-1/2 h-60 w-60 rounded-full pointer-events-none" style={{ background: "hsl(162 90% 45% / 0.1)", filter: "blur(48px)" }} />
            <div className="font-mono-tech" style={{ color: "hsl(0 0% 60%)", fontSize: 10, letterSpacing: "0.18em" }}>› Begin</div>
            <h2 className="mt-3 font-serif-display text-4xl sm:text-6xl leading-tight">
              Know your equity<br/>position in under <span className="silver-text">200ms.</span>
            </h2>
            <div className="mt-8 max-w-xl mx-auto">
              <AddressSearch onSubmit={handleAddress} />
            </div>
            <p className="mt-4 font-mono-tech" style={{ color: "hsl(0 0% 50%)", fontSize: 10, letterSpacing: "0.14em" }}>No card required for teaser valuation</p>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-10" style={{ borderTop: "1px solid hsl(0 0% 100% / 0.05)" }}>
        <div className="container max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="font-serif-display text-base silver-text">TerraAI</span>
            <span className="font-mono-tech" style={{ color: "hsl(0 0% 40%)", fontSize: 10, letterSpacing: "0.14em" }}>© 2026</span>
          </div>
          <div className="font-mono-tech" style={{ color: "hsl(0 0% 40%)", fontSize: 10, letterSpacing: "0.14em" }}>Information Purposes Only · Not Financial Advice</div>
        </div>
      </footer>

      {/* ── Reveal + animation CSS ── */}
      <style>{`
        .reveal.is-visible { opacity: 1 !important; transform: scale(1) translateY(0) !important; }
        @keyframes pulseGlow { 0%,100% { box-shadow: 0 0 20px hsl(162 90% 45% / 0.3); } 50% { box-shadow: 0 0 40px hsl(162 90% 45% / 0.6); } }
        @keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }
        .animate-ping { animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite; }
      `}</style>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} address={authAddress} />
    </div>
  );
}
