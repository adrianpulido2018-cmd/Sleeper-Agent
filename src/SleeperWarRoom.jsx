import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Search, RadioTower, Users, Radar, ClipboardList, TrendingUp, AlertTriangle,
  CircleCheck, Loader2, RefreshCw, ChevronRight, Flame, X, Info, ShieldAlert,
  Ruler, Weight, GraduationCap, Calendar, Star,
} from "lucide-react";

const SEASON = "2026";
const API = "https://api.sleeper.app/v1";
const FANTASY_POS = ["QB", "RB", "WR", "TE", "K", "DEF"];

const POS_STYLE = {
  QB: { text: "text-amber-400", border: "border-amber-400/40", bg: "bg-amber-400/10", ring: "#fbbf24" },
  RB: { text: "text-emerald-400", border: "border-emerald-400/40", bg: "bg-emerald-400/10", ring: "#34d399" },
  WR: { text: "text-sky-400", border: "border-sky-400/40", bg: "bg-sky-400/10", ring: "#38bdf8" },
  TE: { text: "text-fuchsia-400", border: "border-fuchsia-400/40", bg: "bg-fuchsia-400/10", ring: "#e879f9" },
  K: { text: "text-stone-300", border: "border-stone-400/40", bg: "bg-stone-400/10", ring: "#d6d3d1" },
  DEF: { text: "text-orange-400", border: "border-orange-400/40", bg: "bg-orange-400/10", ring: "#fb923c" },
};

const FLEX_MAP = {
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  WRTE_FLEX: ["WR", "TE"],
};

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function heightStr(h) {
  const inches = parseInt(h, 10);
  if (!inches || isNaN(inches)) return "—";
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}
function weightStr(w) {
  return w ? `${w} lbs` : "—";
}
function ageStr(birth_date) {
  if (!birth_date) return null;
  const b = new Date(birth_date);
  if (isNaN(b.getTime())) return null;
  return Math.floor((Date.now() - b.getTime()) / (365.25 * 24 * 3600 * 1000));
}
function injuryMeta(status) {
  const s = (status || "").toLowerCase();
  if (!s) return { label: "Healthy", tone: "text-emerald-400" };
  if (s.includes("out")) return { label: "Out", tone: "text-red-400" };
  if (s.includes("doubt")) return { label: "Doubtful", tone: "text-red-400" };
  if (s.includes("quest")) return { label: "Questionable", tone: "text-amber-400" };
  if (s.includes("ir")) return { label: "IR", tone: "text-red-500" };
  if (s.includes("pup")) return { label: "PUP", tone: "text-red-500" };
  if (s.includes("susp")) return { label: "Suspended", tone: "text-red-500" };
  return { label: status, tone: "text-amber-400" };
}

// ---------- Edge Score engine ----------
// Composite of: (1) Sleeper's public search_rank as an ADP/relevance proxy, percentiled within position,
// (2) an experience curve by position, (3) current health/availability, (4) a boost from YOUR league's
// actual scoring settings (PPR weight, superflex). This is a transparent heuristic, not a stats projection.
function buildAdpPercentiles(players) {
  const groups = {};
  Object.entries(players || {}).forEach(([id, p]) => {
    if (!p || p.active === false) return;
    if (!FANTASY_POS.includes(p.position)) return;
    const rank = typeof p.search_rank === "number" ? p.search_rank : 999999;
    if (rank >= 999000) return;
    (groups[p.position] = groups[p.position] || []).push({ id, rank });
  });
  const pct = {};
  Object.values(groups).forEach((arr) => {
    arr.sort((a, b) => a.rank - b.rank);
    const n = arr.length;
    arr.forEach((item, idx) => {
      pct[item.id] = Math.round(100 * (1 - idx / Math.max(n - 1, 1)));
    });
  });
  return pct;
}

function computeEdge(player, adpPct, pid, isSuperflex, pprType) {
  if (!player) return null;
  const adpFactor = adpPct[pid] ?? 12;
  const exp = player.years_exp ?? 0;
  let expFactor;
  if (exp === 0) expFactor = 55;
  else if (exp <= 2) expFactor = 78;
  else if (exp <= 6) expFactor = 92;
  else if (exp <= 9) expFactor = 76;
  else expFactor = 58;
  if (player.position === "RB" && exp >= 6) expFactor -= 10;
  if ((player.position === "QB" || player.position === "TE") && exp >= 7) expFactor += 6;
  expFactor = Math.max(20, Math.min(100, expFactor));

  const inj = injuryMeta(player.injury_status).label.toLowerCase();
  let healthFactor = 100;
  if (inj === "out") healthFactor = 35;
  else if (inj === "doubtful") healthFactor = 50;
  else if (inj === "questionable") healthFactor = 78;
  else if (inj === "ir" || inj === "pup") healthFactor = 15;
  else if (inj === "suspended") healthFactor = 10;

  let formatFactor = 65;
  if (player.position === "QB" && isSuperflex) formatFactor += 28;
  if ((player.position === "WR" || player.position === "TE") && pprType !== "Standard") formatFactor += 15;
  if (player.position === "RB" && pprType === "Standard") formatFactor += 10;
  formatFactor = Math.min(100, formatFactor);

  const score = Math.round(adpFactor * 0.42 + expFactor * 0.24 + healthFactor * 0.14 + formatFactor * 0.2);
  return { score: Math.max(1, Math.min(99, score)), factors: { adpFactor, expFactor, healthFactor, formatFactor } };
}

function RadialGauge({ score, size = 44, stroke = 4, color = "#fbbf24" }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, score || 0)) / 100) * c;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#292b28" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-mono text-[11px] font-bold text-stone-100">{score ?? "—"}</span>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, sub }) {
  return (
    <div className="flex items-center gap-2 mb-4 pb-3 border-b border-stone-800">
      <div className="w-6 h-6 rounded-md bg-amber-400/10 flex items-center justify-center">
        <Icon size={13} className="text-amber-400" />
      </div>
      <h2 className="font-mono uppercase tracking-[0.2em] text-xs text-stone-300">{title}</h2>
      {sub && <span className="ml-auto font-mono text-[10px] text-stone-400">{sub}</span>}
    </div>
  );
}

function PosBadge({ pos }) {
  const s = POS_STYLE[pos] || POS_STYLE.K;
  return <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border ${s.text} ${s.border} ${s.bg}`}>{pos}</span>;
}

function PlayerRow({ pid, player, edge, tag, onOpen, right }) {
  const s = POS_STYLE[player?.position] || POS_STYLE.K;
  return (
    <button
      onClick={() => onOpen(pid)}
      className="w-full flex items-center gap-3 bg-[#12160F]/80 hover:bg-[#171C13] border border-stone-800 hover:border-stone-700 rounded-xl px-3 py-2.5 transition-colors text-left"
    >
      <RadialGauge score={edge?.score} size={38} stroke={3} color={s.ring} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <PosBadge pos={player?.position} />
          <span className="font-sans text-sm text-stone-100 truncate">{player?.full_name || pid}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="font-mono text-[10px] text-stone-400">{player?.team || "FA"}</span>
          {tag}
        </div>
      </div>
      {right}
      <ChevronRight size={14} className="text-stone-500 shrink-0" />
    </button>
  );
}

function PlayerDrawer({ pid, player, edge, onClose }) {
  if (!pid) return null;
  const s = POS_STYLE[player?.position] || POS_STYLE.K;
  const inj = injuryMeta(player?.injury_status);
  const age = ageStr(player?.birth_date);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm h-full bg-[#0E120D] border-l border-stone-800 overflow-y-auto">
        <div className="p-5">
          <button onClick={onClose} className="absolute top-4 right-4 text-stone-400 hover:text-stone-200">
            <X size={18} />
          </button>
          <PosBadge pos={player?.position} />
          <h2 className="font-sans text-2xl text-stone-50 font-semibold mt-2 leading-tight">
            {player?.full_name || pid}
          </h2>
          <p className="font-mono text-xs text-stone-400 mt-1">
            {player?.team || "Free Agent"} {player?.number ? `· #${player.number}` : ""}
          </p>

          <div className="flex items-center gap-4 mt-5 bg-[#14201A] border border-stone-800 rounded-xl p-4">
            <RadialGauge score={edge?.score} size={64} stroke={5} color={s.ring} />
            <div>
              <p className="font-mono uppercase tracking-widest text-[10px] text-stone-400">Edge Score</p>
              <p className={`font-mono text-3xl font-bold ${s.text}`}>{edge?.score ?? "—"}<span className="text-sm text-stone-500">/99</span></p>
            </div>
          </div>

          {edge && (
            <div className="mt-4 space-y-2.5">
              {[
                ["ADP / relevance", edge.factors.adpFactor],
                ["Experience curve", edge.factors.expFactor],
                ["Health & availability", edge.factors.healthFactor],
                ["Your league format fit", edge.factors.formatFactor],
              ].map(([label, val]) => (
                <div key={label}>
                  <div className="flex justify-between font-mono text-[10px] text-stone-400 mb-1">
                    <span>{label}</span><span>{val}</span>
                  </div>
                  <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${val}%`, background: s.ring }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5 mt-6">
            <div className="bg-[#14201A] border border-stone-800 rounded-xl p-3">
              <p className="font-mono text-[10px] text-stone-400 uppercase tracking-wider flex items-center gap-1"><Ruler size={11}/>Height</p>
              <p className="font-mono text-sm text-stone-100 mt-1">{heightStr(player?.height)}</p>
            </div>
            <div className="bg-[#14201A] border border-stone-800 rounded-xl p-3">
              <p className="font-mono text-[10px] text-stone-400 uppercase tracking-wider flex items-center gap-1"><Weight size={11}/>Weight</p>
              <p className="font-mono text-sm text-stone-100 mt-1">{weightStr(player?.weight)}</p>
            </div>
            <div className="bg-[#14201A] border border-stone-800 rounded-xl p-3">
              <p className="font-mono text-[10px] text-stone-400 uppercase tracking-wider flex items-center gap-1"><Calendar size={11}/>Age</p>
              <p className="font-mono text-sm text-stone-100 mt-1">{age ? `${age} yrs` : "—"}</p>
            </div>
            <div className="bg-[#14201A] border border-stone-800 rounded-xl p-3">
              <p className="font-mono text-[10px] text-stone-400 uppercase tracking-wider flex items-center gap-1"><Star size={11}/>Experience</p>
              <p className="font-mono text-sm text-stone-100 mt-1">{player?.years_exp === 0 ? "Rookie" : `${player?.years_exp ?? "—"} yrs`}</p>
            </div>
            <div className="bg-[#14201A] border border-stone-800 rounded-xl p-3 col-span-2">
              <p className="font-mono text-[10px] text-stone-400 uppercase tracking-wider flex items-center gap-1"><GraduationCap size={11}/>College</p>
              <p className="font-mono text-sm text-stone-100 mt-1">{player?.college || "—"}</p>
            </div>
            <div className="bg-[#14201A] border border-stone-800 rounded-xl p-3 col-span-2">
              <p className="font-mono text-[10px] text-stone-400 uppercase tracking-wider flex items-center gap-1"><ShieldAlert size={11}/>Status</p>
              <p className={`font-mono text-sm mt-1 ${inj.tone}`}>{inj.label}</p>
            </div>
          </div>

          <div className="mt-6 flex items-start gap-2 bg-stone-900/60 border border-stone-800 rounded-xl p-3">
            <Info size={13} className="text-stone-400 mt-0.5 shrink-0" />
            <p className="font-mono text-[10px] text-stone-400 leading-relaxed">
              Edge Score is built from Sleeper's public relevance ranking, an age/experience curve, current
              health status, and your league's actual scoring settings. It's a transparent heuristic to help
              you compare players fast — not a play-by-play stat projection.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SleeperWarRoom() {
  const [phase, setPhase] = useState("login");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);
  const [leagues, setLeagues] = useState([]);
  const [league, setLeague] = useState(null);
  const [rosters, setRosters] = useState([]);
  const [sleeperUsers, setSleeperUsers] = useState([]);
  const [players, setPlayers] = useState(null);
  const [trending, setTrending] = useState([]);
  const [tab, setTab] = useState("overview");
  const [loadingMsg, setLoadingMsg] = useState("");
  const [selectedPid, setSelectedPid] = useState(null);
  const [rankFilter, setRankFilter] = useState("ALL");
  const [rankSearch, setRankSearch] = useState("");
  const [rankShow, setRankShow] = useState(40);

  const handleLogin = async () => {
    if (!username.trim()) return;
    setError(""); setPhase("loading"); setLoadingMsg("FINDING COACH...");
    try {
      const u = await getJSON(`${API}/user/${username.trim()}`);
      if (!u || !u.user_id) throw new Error("not found");
      setUser(u);
      setLoadingMsg("PULLING LEAGUES...");
      const lgs = await getJSON(`${API}/user/${u.user_id}/leagues/nfl/${SEASON}`);
      setLeagues(lgs || []);
      setPhase("picking");
    } catch (e) {
      setError("Couldn't find that Sleeper username, or no " + SEASON + " leagues on file.");
      setPhase("login");
    }
  };

  const handlePickLeague = async (lg) => {
    setPhase("loading"); setError("");
    try {
      setLoadingMsg("LOADING LEAGUE SETTINGS...");
      const [lgFull, ros, usrs, trend] = await Promise.all([
        getJSON(`${API}/league/${lg.league_id}`),
        getJSON(`${API}/league/${lg.league_id}/rosters`),
        getJSON(`${API}/league/${lg.league_id}/users`),
        getJSON(`${API}/players/nfl/trending/add?lookback_hours=24&limit=60`),
      ]);
      setLeague(lgFull); setRosters(ros || []); setSleeperUsers(usrs || []); setTrending(trend || []);
      if (!players) {
        setLoadingMsg("BUILDING PLAYER DATABASE & EDGE SCORES...");
        const p = await getJSON(`${API}/players/nfl`);
        setPlayers(p);
      }
      setPhase("dashboard"); setTab("overview");
    } catch (e) {
      setError("Something broke pulling that league. Try again.");
      setPhase("picking");
    }
  };

  const myRoster = useMemo(() => rosters.find((r) => r.owner_id === user?.user_id), [rosters, user]);

  const starterSlots = useMemo(() => {
    if (!league) return [];
    return (league.roster_positions || []).filter((p) => p !== "BN" && p !== "IR" && p !== "TAXI");
  }, [league]);

  const baseSlotCounts = useMemo(() => {
    const c = {};
    starterSlots.forEach((s) => { if (!FLEX_MAP[s]) c[s] = (c[s] || 0) + 1; });
    return c;
  }, [starterSlots]);

  const flexDemand = useMemo(() => {
    const d = {};
    starterSlots.forEach((s) => {
      const el = FLEX_MAP[s];
      if (el) el.forEach((p) => { d[p] = (d[p] || 0) + 1 / el.length; });
    });
    return d;
  }, [starterSlots]);

  const isSuperflex = starterSlots.includes("SUPER_FLEX");
  const pprType = useMemo(() => {
    const rec = league?.scoring_settings?.rec ?? 0;
    if (rec >= 1) return "Full PPR";
    if (rec >= 0.5) return "Half PPR";
    if (rec > 0) return `${rec} PPR`;
    return "Standard";
  }, [league]);

  const posOf = useCallback((pid) => players?.[pid]?.position || "?", [players]);
  const nameOf = useCallback((pid) => players?.[pid]?.full_name || pid, [players]);

  const adpPct = useMemo(() => (players ? buildAdpPercentiles(players) : {}), [players]);
  const edgeOf = useCallback(
    (pid) => (players && players[pid] ? computeEdge(players[pid], adpPct, pid, isSuperflex, pprType) : null),
    [players, adpPct, isSuperflex, pprType]
  );

  function computeNeeds(rosterObj) {
    if (!rosterObj || !players) return [];
    const depth = {};
    (rosterObj.players || []).forEach((pid) => { const pos = posOf(pid); depth[pos] = (depth[pos] || 0) + 1; });
    return FANTASY_POS.filter(p => p !== "K" && p !== "DEF" || true).map((pos) => {
      const required = (baseSlotCounts[pos] || 0) + (flexDemand[pos] || 0) + (pos === "K" || pos === "DEF" ? 0 : 1);
      const have = depth[pos] || 0;
      return { pos, need: +(required - have).toFixed(1), have, required: +required.toFixed(1) };
    }).sort((a, b) => b.need - a.need);
  }

  const myNeeds = useMemo(() => computeNeeds(myRoster), [myRoster, players, baseSlotCounts, flexDemand]);

  const myEdgeAvg = useMemo(() => {
    if (!myRoster || !players) return null;
    const starters = (myRoster.starters || []).filter((pid) => pid && pid !== "0");
    const scores = starters.map((pid) => edgeOf(pid)?.score).filter((s) => typeof s === "number");
    if (!scores.length) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }, [myRoster, players, edgeOf]);

  const rosteredIds = useMemo(() => {
    const set = new Set();
    rosters.forEach((r) => (r.players || []).forEach((pid) => set.add(pid)));
    return set;
  }, [rosters]);

  const waiverTargets = useMemo(() => {
    if (!players) return [];
    const needSet = new Set(myNeeds.filter((n) => n.need > 0).map((n) => n.pos));
    return trending
      .filter((t) => !rosteredIds.has(t.player_id) && players[t.player_id])
      .map((t) => {
        const p = players[t.player_id];
        const e = edgeOf(t.player_id);
        return { id: t.player_id, count: t.count, pos: p.position, matchesNeed: needSet.has(p.position), edge: e };
      })
      .filter((p) => FANTASY_POS.includes(p.pos))
      .sort((a, b) => (b.matchesNeed - a.matchesNeed) || (b.edge?.score || 0) - (a.edge?.score || 0))
      .slice(0, 30);
  }, [trending, players, rosteredIds, myNeeds, edgeOf]);

  const teamLabel = useCallback((r) => {
    const u = sleeperUsers.find((su) => su.user_id === r.owner_id);
    return u?.metadata?.team_name || u?.display_name || `Roster ${r.roster_id}`;
  }, [sleeperUsers]);

  const leagueIntel = useMemo(() => {
    if (!players) return [];
    return rosters.filter((r) => r.roster_id !== myRoster?.roster_id).map((r) => ({
      label: teamLabel(r),
      needs: computeNeeds(r).filter((n) => n.need > 0.4).slice(0, 3),
      record: `${r.settings?.wins ?? 0}-${r.settings?.losses ?? 0}${r.settings?.ties ? "-" + r.settings.ties : ""}`,
    })).sort((a, b) => b.needs.reduce((s, n) => s + n.need, 0) - a.needs.reduce((s, n) => s + n.need, 0));
  }, [rosters, players, myRoster, teamLabel]);

  const allRanked = useMemo(() => {
    if (!players) return [];
    return Object.entries(players)
      .filter(([id, p]) => p && p.active !== false && FANTASY_POS.includes(p.position) && (adpPct[id] ?? 0) > 0)
      .map(([id, p]) => ({ id, p, edge: computeEdge(p, adpPct, id, isSuperflex, pprType) }))
      .sort((a, b) => b.edge.score - a.edge.score);
  }, [players, adpPct, isSuperflex, pprType]);

  const filteredRanked = useMemo(() => {
    return allRanked.filter((r) => (rankFilter === "ALL" || r.p.position === rankFilter))
      .filter((r) => r.p.full_name?.toLowerCase().includes(rankSearch.toLowerCase()));
  }, [allRanked, rankFilter, rankSearch]);

  if (phase === "login" || phase === "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#0B0E0C] to-[#0E120D] text-stone-200 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-6 justify-center">
            <RadioTower size={20} className="text-amber-400" />
            <span className="font-mono uppercase tracking-[0.3em] text-xs text-stone-400">War Room</span>
          </div>
          <h1 className="text-4xl font-sans font-bold text-center text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-amber-500 mb-1 tracking-tight">
            SLEEPER INTEL
          </h1>
          <p className="text-center text-stone-400 text-sm mb-8">Scout your league. Outsmart the room.</p>
          {phase === "loading" ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="animate-spin text-amber-400" size={28} />
              <span className="font-mono text-xs tracking-widest text-stone-400 text-center">{loadingMsg}</span>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  value={username} onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  placeholder="Sleeper username"
                  className="flex-1 bg-[#14201A] border border-stone-700 rounded-xl px-3 py-2.5 text-sm text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-400"
                />
                <button onClick={handleLogin} className="bg-amber-400 text-black px-4 rounded-xl font-bold hover:bg-amber-300 transition-colors">
                  <Search size={16} />
                </button>
              </div>
              {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
              <p className="text-stone-500 text-[11px] mt-6 text-center leading-relaxed">
                Public Sleeper data only — no password needed.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (phase === "picking") {
    return (
      <div className="min-h-screen bg-[#0B0E0C] text-stone-200 p-6">
        <div className="max-w-md mx-auto">
          <p className="font-mono text-xs text-stone-400 mb-1">SIGNED IN AS</p>
          <h1 className="text-xl text-amber-400 mb-6 font-semibold">{user?.display_name}</h1>
          <p className="font-mono text-xs uppercase tracking-widest text-stone-400 mb-3">Pick a {SEASON} league</p>
          <div className="space-y-2">
            {leagues.length === 0 && <p className="text-stone-400 text-sm">No {SEASON} leagues found on this account.</p>}
            {leagues.map((lg) => (
              <button key={lg.league_id} onClick={() => handlePickLeague(lg)}
                className="w-full text-left bg-[#14201A] border border-stone-700 rounded-xl px-4 py-3 hover:border-amber-400 transition-colors flex items-center justify-between">
                <div>
                  <p className="text-sm text-stone-100">{lg.name}</p>
                  <p className="font-mono text-[10px] text-stone-400 uppercase tracking-wider">{lg.total_rosters} teams · {lg.status}</p>
                </div>
                <ChevronRight size={16} className="text-stone-500" />
              </button>
            ))}
          </div>
          {error && <p className="text-red-400 text-xs mt-4">{error}</p>}
        </div>
      </div>
    );
  }

  const selectedPlayer = selectedPid ? players?.[selectedPid] : null;
  const selectedEdge = selectedPid ? edgeOf(selectedPid) : null;

  const tabs = [
    { id: "overview", label: "Overview", icon: RadioTower },
    { id: "roster", label: "My Roster", icon: ClipboardList },
    { id: "waivers", label: "Waivers", icon: TrendingUp },
    { id: "rankings", label: "Rankings", icon: Star },
    { id: "intel", label: "Intel", icon: Radar },
  ];

  return (
    <div className="min-h-screen bg-[#0B0E0C] text-stone-200 font-sans">
      <div className="bg-[#12160F] border-b border-stone-800 px-4 py-3 sticky top-0 z-20">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-400/10 flex items-center justify-center shrink-0">
            <RadioTower size={16} className="text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="uppercase tracking-[0.1em] text-sm text-stone-100 truncate font-semibold">{league?.name}</p>
            <p className="font-mono text-[10px] text-stone-400 uppercase tracking-wider">
              {pprType} · {league?.settings?.num_teams ?? rosters.length} teams{isSuperflex ? " · SUPERFLEX" : ""}
            </p>
          </div>
          <button onClick={() => setPhase("picking")} className="ml-auto text-stone-400 hover:text-amber-400 shrink-0">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="border-b border-stone-800 sticky top-[57px] bg-[#0B0E0C] z-10">
        <div className="max-w-2xl mx-auto flex overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3 font-mono text-[11px] uppercase tracking-wider whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id ? "border-amber-400 text-amber-400" : "border-transparent text-stone-400 hover:text-stone-300"
              }`}>
              <t.icon size={13} />{t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-8">
        {tab === "overview" && (
          <>
            <div>
              <SectionHeader icon={RadioTower} title="League Signature" />
              <div className="grid grid-cols-2 gap-3">
                {[["Scoring", pprType], ["QB Format", isSuperflex ? "Superflex" : "1-QB"],
                  ["Pass TD", league?.scoring_settings?.pass_td ?? 4], ["Reception", league?.scoring_settings?.rec ?? 0]]
                  .map(([label, val]) => (
                  <div key={label} className="bg-[#12160F] border border-stone-800 rounded-xl p-3">
                    <p className="font-mono text-[10px] text-stone-400 uppercase tracking-wider mb-1">{label}</p>
                    <p className="text-amber-400 text-lg font-semibold">{val}</p>
                  </div>
                ))}
              </div>
            </div>

            {myEdgeAvg !== null && (
              <div className="bg-gradient-to-br from-[#14201A] to-[#12160F] border border-stone-800 rounded-xl p-4 flex items-center gap-4">
                <RadialGauge score={myEdgeAvg} size={60} stroke={5} color="#fbbf24" />
                <div>
                  <p className="font-mono uppercase tracking-widest text-[10px] text-stone-400">Starting Lineup Edge</p>
                  <p className="text-stone-300 text-sm mt-0.5">Average Edge Score across your current starters.</p>
                </div>
              </div>
            )}

            <div>
              <SectionHeader icon={AlertTriangle} title="Your Top Needs" sub="heuristic" />
              <div className="space-y-1.5">
                {myNeeds.filter((n) => n.need > 0.2).slice(0, 4).map((n) => (
                  <div key={n.pos} className="flex items-center gap-3 bg-[#12160F] border border-stone-800 rounded-xl px-3 py-2.5">
                    <PosBadge pos={n.pos} />
                    <span className="font-mono text-[11px] text-stone-400">{n.have} rostered · ~{n.required} needed</span>
                    <span className="ml-auto font-mono text-[10px] text-red-400 uppercase tracking-wider">Priority</span>
                  </div>
                ))}
                {myNeeds.filter((n) => n.need > 0.2).length === 0 && (
                  <p className="text-xs text-emerald-400 flex items-center gap-1.5"><CircleCheck size={14} /> Roster's balanced.</p>
                )}
              </div>
            </div>
          </>
        )}

        {tab === "roster" && (
          <div>
            <SectionHeader icon={ClipboardList} title="My Roster" sub={myRoster ? teamLabel(myRoster) : ""} />
            <div className="space-y-1.5">
              {(myRoster?.players || []).slice().sort((a, b) => (edgeOf(b)?.score || 0) - (edgeOf(a)?.score || 0)).map((pid) => {
                const isStarter = (myRoster.starters || []).includes(pid);
                return (
                  <PlayerRow key={pid} pid={pid} player={players[pid]} edge={edgeOf(pid)} onOpen={setSelectedPid}
                    tag={<span className={`font-mono text-[9px] uppercase tracking-wider ${isStarter ? "text-amber-400" : "text-stone-500"}`}>{isStarter ? "Starter" : "Bench"}</span>} />
                );
              })}
              {!myRoster && <p className="text-xs text-stone-400">Couldn't match your user to a roster here yet.</p>}
            </div>
          </div>
        )}

        {tab === "waivers" && (
          <div>
            <SectionHeader icon={TrendingUp} title="Trending Free Agents" sub="last 24h, ranked by Edge" />
            <div className="space-y-1.5">
              {waiverTargets.map((p) => (
                <PlayerRow key={p.id} pid={p.id} player={players[p.id]} edge={p.edge} onOpen={setSelectedPid}
                  tag={p.matchesNeed ? <span className="font-mono text-[9px] text-amber-400 uppercase tracking-wider flex items-center gap-1"><Flame size={9}/>Fits need</span> : <span className="font-mono text-[9px] text-stone-500">{p.count} adds</span>} />
              ))}
              {waiverTargets.length === 0 && <p className="text-xs text-stone-400">No trending free agents surfaced right now.</p>}
            </div>
          </div>
        )}

        {tab === "rankings" && (
          <div>
            <SectionHeader icon={Star} title="Edge Score Rankings" sub={`${filteredRanked.length} players`} />
            <input value={rankSearch} onChange={(e) => setRankSearch(e.target.value)} placeholder="Search a player..."
              className="w-full bg-[#12160F] border border-stone-800 rounded-xl px-3 py-2 text-sm mb-3 focus:outline-none focus:border-amber-400" />
            <div className="flex gap-1.5 mb-4 overflow-x-auto">
              {["ALL", ...FANTASY_POS].map((p) => (
                <button key={p} onClick={() => { setRankFilter(p); setRankShow(40); }}
                  className={`font-mono text-[10px] px-2.5 py-1 rounded-full border whitespace-nowrap ${rankFilter === p ? "bg-amber-400 text-black border-amber-400 font-bold" : "border-stone-700 text-stone-400"}`}>
                  {p}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              {filteredRanked.slice(0, rankShow).map((r) => (
                <PlayerRow key={r.id} pid={r.id} player={r.p} edge={r.edge} onOpen={setSelectedPid} />
              ))}
            </div>
            {filteredRanked.length > rankShow && (
              <button onClick={() => setRankShow((n) => n + 40)} className="w-full mt-3 py-2.5 rounded-xl border border-stone-800 text-stone-400 text-xs font-mono uppercase tracking-wider hover:border-amber-400 hover:text-amber-400">
                Show more
              </button>
            )}
          </div>
        )}

        {tab === "intel" && (
          <div>
            <SectionHeader icon={Radar} title="Around the League" sub="find trade leverage" />
            <div className="space-y-2">
              {leagueIntel.map((t, i) => (
                <div key={i} className="bg-[#12160F] border border-stone-800 rounded-xl px-3 py-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm text-stone-100">{t.label}</span>
                    <span className="font-mono text-[10px] text-stone-400">{t.record}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {t.needs.length === 0 && <span className="font-mono text-[10px] text-stone-500">No clear holes</span>}
                    {t.needs.map((n) => (
                      <span key={n.pos} className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border ${POS_STYLE[n.pos].text} ${POS_STYLE[n.pos].border}`}>thin {n.pos}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="font-mono text-[10px] text-stone-500 mt-4 leading-relaxed">
              Teams thin at a position you're deep in are your best trade targets.
            </p>
          </div>
        )}
      </div>

      <PlayerDrawer pid={selectedPid} player={selectedPlayer} edge={selectedEdge} onClose={() => setSelectedPid(null)} />
    </div>
  );
}
