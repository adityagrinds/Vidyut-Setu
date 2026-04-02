import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  Award, Banknote, Download, Home, Leaf, LoaderCircle,
  ShieldCheck, Star, SunMedium, Trash2, Zap, X,
  TrendingUp, Wind,
} from "lucide-react";
import { io } from "socket.io-client";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5055/api";
const WS_URL   = import.meta.env.VITE_WS_URL   || "http://localhost:5055";
const CO2_PER_KWH = 0.82;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const makeIK = () => `vidyut-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const APP_STORAGE_KEY = "vidyut.auth";

const DEMO = {
  prosumer: { email: "prosumer@sauryasetu.local", password: "123456" },
  consumer: { email: "consumer@sauryasetu.local", password: "123456" },
  consumer2: { email: "consumer2@sauryasetu.local", password: "123456" },
  consumer3: { email: "consumer3@sauryasetu.local", password: "123456" },
};

const DEMO_META = {
  prosumer: { label: "Prosumer", house: "House #42", role: "Solar Seller" },
  consumer: { label: "Consumer 1", house: "House #19", role: "Energy Buyer" },
  consumer2: { label: "Consumer 2", house: "House #27", role: "Energy Buyer" },
  consumer3: { label: "Consumer 3", house: "House #61", role: "Energy Buyer" },
};

/* ───────── Toast System ───────── */
let _toastId = 0;
function useToast() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((type, title, body = "") => {
    const id = ++_toastId;
    setToasts((p) => [...p, { id, type, title, body }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 4000);
  }, []);
  const dismiss = useCallback((id) => setToasts((p) => p.filter((t) => t.id !== id)), []);
  return { toasts, push, dismiss };
}

const TOAST_ICONS = { success: "✅", error: "❌", info: "⚡" };

/* ───────── Main App ───────── */
export default function App() {
  const { toasts, push, dismiss } = useToast();

  const [booting,    setBooting]    = useState(true);
  const [token,      setToken]      = useState("");
  const [user,       setUser]       = useState(null);
  const [listings,   setListings]   = useState([]);
  const [ledgerRows, setLedgerRows] = useState([]);
  const [communityStats, setCommunityStats] = useState(null);

  const [genKw,  setGenKw]  = useState(4.24);
  const [conKw,  setConKw]  = useState(2.10);
  const [energyHistory, setEnergyHistory] = useState(
    Array.from({ length: 10 }, (_, i) => ({ t: i + 1, gen: 4.2, con: 2.1 }))
  );

  const [broadcastOpen,  setBroadcastOpen]  = useState(false);
  const [broadcastState, setBroadcastState] = useState("idle");
  const [paymentOpen,    setPaymentOpen]    = useState(false);
  const [buyIntent,      setBuyIntent]      = useState(null);
  const [payToken,       setPayToken]       = useState("");
  const [buyStage,       setBuyStage]       = useState("");
  const [busyId,         setBusyId]         = useState("");
  const [walletFlash,    setWalletFlash]    = useState(false);
  const [selectedTxn,    setSelectedTxn]    = useState(null);
  const [certData,       setCertData]       = useState(null);
  const [certLoading,    setCertLoading]    = useState(false);
  const [quantityMap,    setQuantityMap]    = useState({});
  const [activeTab,      setActiveTab]      = useState("market"); // market | community | ledger
  const [marketQuery,    setMarketQuery]    = useState("");
  const [maxPrice,       setMaxPrice]       = useState("");
  const [sortBy,         setSortBy]         = useState("newest");
  const [systemHealth,   setSystemHealth]   = useState({ status: "checking", mongo: "unknown", uptimeSec: 0 });
  const [lastSyncAt,     setLastSyncAt]     = useState(null);

  const socketRef = useRef(null);
  const isProsumer = user?.role === "prosumer";
  const isConsumer = user?.role === "consumer";
  const netSurplus = useMemo(() => Number((genKw - conKw).toFixed(2)), [genKw, conKw]);
  const authH = useMemo(
    () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` }),
    [token]
  );

  /* Boot animation */
  useEffect(() => { const t = setTimeout(() => setBooting(false), 2000); return () => clearTimeout(t); }, []);

  /* Live meter simulation */
  useEffect(() => {
    const iv = setInterval(() => {
      setGenKw((p) => {
        const v = Number(Math.max(2.0, Math.min(7.5, p + (Math.random() * 0.8 - 0.25))).toFixed(2));
        setConKw((c) => {
          const cv = Number(Math.max(1.0, Math.min(6.0, c + (Math.random() * 0.6 - 0.2))).toFixed(2));
          setEnergyHistory((h) => {
            const next = [...h.slice(-9), { t: h.length + 1, gen: v, con: cv }];
            return next;
          });
          return cv;
        });
        return v;
      });
    }, 3500);
    return () => clearInterval(iv);
  }, []);

  /* Restore previous session for smoother demos */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(APP_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved?.token && saved?.user) {
        setToken(saved.token);
        setUser(saved.user);
      }
    } catch {
      localStorage.removeItem(APP_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!token || !user) return;
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify({ token, user }));
  }, [token, user]);

  useEffect(() => {
    const onEsc = (event) => {
      if (event.key !== "Escape") return;
      setBroadcastOpen(false);
      setPaymentOpen(false);
      setSelectedTxn(null);
      setCertData(null);
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

  const requestJson = useCallback(async (url, options = {}) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || `Request failed (${response.status})`);
      }
      return payload;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("Request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const health = await requestJson(`${API_BASE}/health`);
      setSystemHealth({
        status: health.status === "ok" ? "online" : "degraded",
        mongo: health.mongo || "unknown",
        uptimeSec: health.uptimeSec || 0,
      });
    } catch {
      setSystemHealth({ status: "offline", mongo: "unknown", uptimeSec: 0 });
    }
  }, [requestJson]);

  useEffect(() => {
    refreshHealth();
    const iv = setInterval(refreshHealth, 15000);
    return () => clearInterval(iv);
  }, [refreshHealth]);

  /* API helpers */
  const refreshWallet = useCallback(async () => {
    if (!token) return;
    try {
      const data = await requestJson(`${API_BASE}/wallet/me`, { headers: authH });
      setUser(data.user);
    } catch (error) {
      console.warn("Wallet refresh failed", error.message);
    }
  }, [token, requestJson, authH]);

  const refreshListings = useCallback(async () => {
    if (!token) return;
    try {
      const data = await requestJson(`${API_BASE}/listings`, { headers: authH });
      setListings(data.listings || []);
    } catch (error) {
      console.warn("Listings refresh failed", error.message);
    }
  }, [token, requestJson, authH]);

  const refreshLedger = useCallback(async () => {
    if (!token) return;
    try {
      const data = await requestJson(`${API_BASE}/ledger/recent`, { headers: authH });
      setLedgerRows(data.rows || []);
    } catch (error) {
      console.warn("Ledger refresh failed", error.message);
    }
  }, [token, requestJson, authH]);

  const refreshCommunity = useCallback(async () => {
    if (!token) return;
    try {
      const data = await requestJson(`${API_BASE}/community/stats`, { headers: authH });
      setCommunityStats(data);
    } catch (error) {
      console.warn("Community refresh failed", error.message);
    }
  }, [token, requestJson, authH]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshWallet(), refreshListings(), refreshLedger(), refreshCommunity()]);
    setLastSyncAt(new Date());
  }, [refreshWallet, refreshListings, refreshLedger, refreshCommunity]);

  useEffect(() => {
    if (!token) return;
    refreshAll();
    const iv = setInterval(() => {
      refreshAll();
    }, 8000);
    return () => clearInterval(iv);
  }, [token, refreshAll]);

  /* WebSocket */
  useEffect(() => {
    if (!token) return;
    const sock = io(WS_URL, { auth: { token }, transports: ["websocket"] });
    socketRef.current = sock;
    sock.on("connect", () => console.log("WS connected"));
    sock.on("trade:settled", (data) => {
      push("success", "⚡ Trade Settled!", `${data.energyKw} kW from House #${data.sellerHouseId} — ${data.co2SavedKg} kg CO₂ saved`);
      refreshAll();
    });
    sock.on("listing:new", () => {
      refreshListings();
      refreshCommunity();
    });
    return () => {
      sock.disconnect();
      socketRef.current = null;
    };
  }, [token, push, refreshAll, refreshListings, refreshCommunity]);

  /* Login */
  const loginDemo = async (role) => {
    const creds = DEMO[role];
    if (!creds) {
      push("error", "Unknown Demo User", "Requested demo account was not found.");
      return;
    }

    try {
      const data = await requestJson(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creds),
      });
      setToken(data.token);
      setUser(data.user);
      setPayToken("");
      localStorage.setItem(APP_STORAGE_KEY, JSON.stringify({ token: data.token, user: data.user }));
      push("info", "Welcome back!", `Logged in as ${data.user.role}`);
    } catch (error) {
      push("error", "Login Failed", error.message || "Cannot reach backend.");
    }
  };

  /* Broadcast */
  const submitBroadcast = async () => {
    try {
      setBroadcastState("loading");
      const d = await requestJson(`${API_BASE}/broadcast`, {
        method: "POST", headers: authH,
        body: JSON.stringify({ surplusKw: netSurplus }),
      });
      await delay(600);
      setBroadcastState("success");
      push("success", "Energy Broadcasted!", `${netSurplus.toFixed(2)} kW listed at ${d.dynamicPrice} $TET/kW`);
      await refreshAll();
    } catch (e) {
      push("error", "Broadcast Failed", e.message);
      setBroadcastState("idle");
    }
  };

  /* Delete listing */
  const deleteListing = async (id) => {
    try {
      await requestJson(`${API_BASE}/listings/${id}`, { method: "DELETE", headers: authH });
      push("info", "Listing Removed");
      await refreshListings();
    } catch (error) {
      push("error", "Delete Failed", error.message);
    }
  };

  /* Trade */
  const openPayment = (listing) => {
    const qty = Number(quantityMap[listing.id] || listing.availableKw);
    if (!qty || qty <= 0) { push("error", "Invalid Quantity", "Enter a valid kW amount"); return; }
    setBuyIntent({ listing, desiredKw: qty });
    setPayToken("");
    setPaymentOpen(true);
  };

  const confirmPaymentAndBuy = async () => {
    if (!buyIntent) return;
    try {
      setBusyId(buyIntent.listing.id);
      setBuyStage("Initializing Smart Contract...");
      await delay(1200);
      setBuyStage("Verifying Thore Ledger...");
      await delay(900);
      setBuyStage("Executing Atomic Swap...");
      await delay(900);

      const result = await requestJson(`${API_BASE}/trade`, {
        method: "POST",
        headers: { ...authH, "x-idempotency-key": makeIK() },
        body: JSON.stringify({
          listingId: buyIntent.listing.id,
          requestedKw: buyIntent.desiredKw,
          paymentToken: payToken,
        }),
      });

      setWalletFlash(true);
      setTimeout(() => setWalletFlash(false), 500);
      setPaymentOpen(false);
      setBuyIntent(null);
      push("success", "Payment Confirmed! ✅",
        `${result.deductedTet.toFixed(2)} $TET deducted · ${result.co2SavedKg.toFixed(3)} kg CO₂ saved`);
      await refreshAll();
    } catch (e) {
      push("error", "Payment Failed", e.message);
    } finally {
      setBuyStage("");
      setBusyId("");
    }
  };

  /* Certificate */
  const downloadCertificate = async (txnId) => {
    setCertLoading(true);
    try {
      const d = await requestJson(`${API_BASE}/ledger/certificate/${txnId}`, { headers: authH });
      setCertData(d.certificate);
    } catch (e) {
      push("error", "Certificate Failed", e.message);
    } finally {
      setCertLoading(false);
    }
  };

  const downloadCertAsJSON = () => {
    if (!certData) return;
    const blob = new Blob([JSON.stringify(certData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `GreenCert-${certData.paymentId}.json`; a.click();
    URL.revokeObjectURL(url);
    push("success", "Certificate Downloaded!", "Your REC has been saved.");
  };

  const myListings = useMemo(() => listings.filter((l) => l.sellerId === user?.id), [listings, user?.id]);

  const filteredListings = useMemo(() => {
    const max = Number(maxPrice || 0);
    const query = marketQuery.trim().toLowerCase();
    const list = listings.filter((item) => {
      const matchQuery =
        query.length === 0 ||
        item.sellerName.toLowerCase().includes(query) ||
        item.sellerHouse.toLowerCase().includes(query);
      const matchPrice = max <= 0 || item.pricePerKw <= max;
      return matchQuery && matchPrice;
    });

    if (sortBy === "price-asc") list.sort((a, b) => a.pricePerKw - b.pricePerKw);
    if (sortBy === "price-desc") list.sort((a, b) => b.pricePerKw - a.pricePerKw);
    if (sortBy === "energy-desc") list.sort((a, b) => b.availableKw - a.availableKw);
    return list;
  }, [listings, marketQuery, maxPrice, sortBy]);

  const lastSyncLabel = useMemo(() => {
    if (!lastSyncAt) return "never";
    const diff = Math.max(0, Math.floor((Date.now() - lastSyncAt.getTime()) / 1000));
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }, [lastSyncAt]);

  /* ───────── Render ───────── */

  if (booting) return (
    <div className="boot-screen">
      <div className="aurora-bg" /><div className="grid-lines" />
      <div className="boot-core">
        <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>⚡</div>
        <h1 className="font-orbitron" style={{ fontSize: "2rem", margin: "0.3rem 0", letterSpacing: "0.08em", color: "#e5f7ff" }}>
          Vidyut Setu
        </h1>
        <p style={{ color: "var(--on-surface-dim)", fontSize: "0.9rem", margin: "0.4rem 0 1.2rem" }}>
          Booting decentralized energy mesh...
        </p>
        <div className="boot-bar"><span className="boot-fill" /></div>
        <p style={{ fontSize: "0.72rem", color: "var(--on-surface-dim)", marginTop: "0.8rem", letterSpacing: "0.06em" }}>
          INITIALIZING · THORE NETWORK · P2P SOLAR GRID
        </p>
      </div>
    </div>
  );

  if (!user) return (
    <div style={{ minHeight: "100vh", padding: "2rem 1.5rem", position: "relative", overflow: "hidden" }}>
      <div className="aurora-bg" /><div className="grid-lines" />
      <div className="depth-orb depth-orb-a" /><div className="depth-orb depth-orb-b" />
      <div className="scene-vignette" />
      <main style={{ position: "relative", zIndex: 10, maxWidth: "860px", margin: "0 auto" }}>
        <header style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>☀️</div>
          <h1 className="logo-text" style={{ fontSize: "clamp(2rem,5vw,3.2rem)" }}>Vidyut Setu</h1>
          <p style={{ color: "var(--on-surface-dim)", marginTop: "0.6rem" }}>
            Decentralized P2P Solar Energy Trading · Thore Network
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: "0.6rem", marginTop: "1rem", flexWrap: "wrap" }}>
            <span className="badge badge-amber">🌿 0.82 kg CO₂ saved per kWh</span>
            <span className="badge badge-cyan">⚡ Atomic Settlement</span>
            <span className="badge badge-green">🔗 Tamper-Proof Ledger</span>
          </div>
        </header>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.5rem" }}>
          <button onClick={() => loginDemo("prosumer")} className="role-card" style={{ cursor: "pointer", border: "none" }}>
            <SunMedium style={{ width: "2.2rem", height: "2.2rem", color: "var(--secondary)", marginBottom: "0.8rem" }} />
            <h2 className="font-space" style={{ fontSize: "1.4rem", margin: "0 0 0.5rem", color: "var(--on-surface)" }}>
              Prosumer Command Deck
            </h2>
            <p style={{ color: "var(--on-surface-dim)", fontSize: "0.88rem", margin: 0 }}>
              Monitor solar generation, publish surplus energy packets, set dynamic prices, control listing lifecycle.
            </p>
            <div style={{ marginTop: "1rem" }}>
              <span className="badge badge-amber">☀️ Solar Producer</span>
            </div>
          </button>
          <button onClick={() => loginDemo("consumer")} className="role-card" style={{ cursor: "pointer", border: "none" }}>
            <Banknote style={{ width: "2.2rem", height: "2.2rem", color: "var(--primary)", marginBottom: "0.8rem" }} />
            <h2 className="font-space" style={{ fontSize: "1.4rem", margin: "0 0 0.5rem", color: "var(--on-surface)" }}>
              Consumer Settlement Deck
            </h2>
            <p style={{ color: "var(--on-surface-dim)", fontSize: "0.88rem", margin: 0 }}>
              Browse the live P2P marketplace, buy exact kW with token-verified atomic payment, download green certificates.
            </p>
            <div style={{ marginTop: "1rem" }}>
              <span className="badge badge-cyan">🏠 Energy Buyer</span>
            </div>
          </button>
        </div>

        <section style={{ marginTop: "1.4rem" }}>
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "var(--on-surface-dim)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
            Quick Demo Profiles
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.6rem" }}>
            {Object.entries(DEMO_META).map(([key, meta]) => (
              <button
                key={key}
                onClick={() => loginDemo(key)}
                className="btn"
                style={{ justifyContent: "space-between", padding: "0.65rem 0.8rem", textAlign: "left" }}
              >
                <span>
                  <strong style={{ display: "block", color: "var(--on-surface)", fontSize: "0.78rem" }}>{meta.label}</strong>
                  <span style={{ fontSize: "0.68rem", color: "var(--on-surface-dim)" }}>{meta.house}</span>
                </span>
                <span className="badge badge-cyan" style={{ fontSize: "0.62rem" }}>{meta.role}</span>
              </button>
            ))}
          </div>
        </section>
      </main>
      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", overflowX: "hidden", padding: "1.2rem 1rem 2rem", position: "relative" }}>
      <div className="aurora-bg" /><div className="grid-lines" />
      <div className="depth-orb depth-orb-a" /><div className="depth-orb depth-orb-b" /><div className="depth-orb depth-orb-c" />
      <div className="scene-vignette" />

      {/* NAVBAR */}
      <header style={{
        position: "relative", zIndex: 10, marginBottom: "1.2rem",
        borderRadius: "20px", border: "1px solid rgba(64,72,87,0.5)",
        background: "rgba(10,20,34,0.8)", backdropFilter: "blur(20px)",
        padding: "0.9rem 1.3rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.8rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div className="logo-core"><Zap style={{ width: "1.3rem", height: "1.3rem", color: "#fde68a" }} /></div>
            <div>
              <p className="logo-text" style={{ fontSize: "1.35rem" }}>Vidyut Setu</p>
              <p style={{ fontSize: "0.72rem", color: "var(--on-surface-dim)", margin: 0, letterSpacing: "0.05em" }}>
                {isProsumer ? "PROSUMER" : "CONSUMER"} · House #{user.houseId}
              </p>
              <p style={{ margin: "3px 0 0", fontSize: "0.68rem", color: "var(--on-surface-dim)" }}>
                Sync: {lastSyncLabel}
              </p>
            </div>
          </div>

          {/* Nav tabs */}
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {[["market", "⚡ Market"], ["community", "🌿 Community"], ["ledger", "📋 Ledger"]].map(([k, l]) => (
              <button key={k} onClick={() => setActiveTab(k)} className="btn" style={{
                fontSize: "0.78rem", padding: "0.4rem 0.8rem",
                ...(activeTab === k ? { borderColor: "rgba(58,223,250,0.6)", color: "var(--primary)", background: "rgba(58,223,250,0.1)" } : {}),
              }}>{l}</button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.35rem 0.55rem", borderRadius: "10px", border: "1px solid rgba(64,72,87,0.45)", background: "rgba(6,14,27,0.55)" }}>
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "999px",
                  background:
                    systemHealth.status === "online"
                      ? "#58e7ab"
                      : systemHealth.status === "degraded"
                        ? "#fd933d"
                        : "#ff716c",
                  boxShadow: "0 0 12px rgba(88,231,171,0.5)",
                }}
              />
              <span style={{ fontSize: "0.66rem", color: "var(--on-surface-dim)", letterSpacing: "0.04em" }}>
                API {systemHealth.status.toUpperCase()} · DB {String(systemHealth.mongo).toUpperCase()} · UPTIME {Math.floor(Number(systemHealth.uptimeSec || 0) / 60)}m
              </span>
            </div>
            <div style={{ textAlign: "right", padding: "0.4rem 0.9rem", borderRadius: "12px", border: "1px solid rgba(58,223,250,0.2)", background: "rgba(58,223,250,0.06)" }}>
              <p style={{ fontSize: "0.65rem", color: "var(--on-surface-dim)", margin: 0 }}>WALLET</p>
              <p className={`font-orbitron ${walletFlash ? "animate-flash-red" : "glow-cyan"}`} style={{ fontSize: "1.3rem", margin: 0 }}>
                {Number(user.walletBalance || 0).toFixed(2)} <span style={{ fontSize: "0.7rem" }}>$TET</span>
              </p>
            </div>
            <button
              onClick={() => {
                setToken("");
                setUser(null);
                localStorage.removeItem(APP_STORAGE_KEY);
              }}
              className="btn btn-danger"
              style={{ fontSize: "0.78rem", padding: "0.4rem 0.8rem" }}
            >
              Switch User
            </button>
          </div>
        </div>
      </header>

      {/* COMMUNITY IMPACT BANNER */}
      {communityStats && (
        <div className="impact-banner" style={{ position: "relative", zIndex: 10, marginBottom: "1.2rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "0.8rem", alignItems: "center" }}>
            <div className="impact-stat">
              <span className="value glow-cyan">{communityStats.totalEnergyKwh}</span>
              <span className="label">kWh Traded</span>
            </div>
            <div className="impact-stat">
              <span className="value glow-green">{communityStats.totalCo2Kg} kg</span>
              <span className="label">CO₂ Offset</span>
            </div>
            <div className="impact-stat">
              <span className="value glow-green">🌲 {communityStats.treesEquivalent}</span>
              <span className="label">Trees Equiv.</span>
            </div>
            <div className="impact-stat">
              <span className="value glow-amber">{communityStats.activeProsumers}</span>
              <span className="label">Prosumers</span>
            </div>
            <div className="impact-stat">
              <span className="value" style={{ color: "var(--on-surface)" }}>{communityStats.totalTrades}</span>
              <span className="label">Trades Today</span>
            </div>
            <div className="impact-stat">
              <span className="value glow-amber">{communityStats.dynamicPrice} $TET</span>
              <span className="label">AI Price/kW</span>
            </div>
            <div className="impact-stat">
              <span className="value glow-green">₹{communityStats.gridSavingsRupees}</span>
              <span className="label">Grid Savings</span>
            </div>
          </div>
        </div>
      )}

      {/* ════════ MARKET TAB ════════ */}
      {activeTab === "market" && (
        <div style={{ position: "relative", zIndex: 10, display: "flex", flexDirection: "column", gap: "1.2rem" }}>

          {/* PROSUMER — Live Orbit */}
          {isProsumer && (
            <div className="panel">
              <div className="orbit-glow" />
              <h2 className="font-space" style={{ fontSize: "1.4rem", color: "var(--secondary)", margin: "0 0 1rem" }}>
                ☀️ Live Orbit
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "1.1rem" }}>
                <MeterCard label="Generation" value={`${genKw.toFixed(2)} kW`} icon={<SunMedium className="animate-spin-slow" style={{ color: "var(--secondary)" }} />} color="glow-amber" />
                <MeterCard label="Consumption" value={`${conKw.toFixed(2)} kW`} icon={<Home style={{ color: "var(--primary)" }} />} color="glow-cyan" />
                <MeterCard
                  label="Net Surplus" value={`${netSurplus >= 0 ? "+" : ""}${netSurplus.toFixed(2)} kW`}
                  sub={netSurplus >= 0 ? `≈ ${(netSurplus * CO2_PER_KWH).toFixed(2)} kg CO₂ potential` : "Drawing from grid"}
                  color={netSurplus >= 0 ? "glow-green" : "glow-red"}
                  icon={<Wind style={{ color: netSurplus >= 0 ? "var(--tertiary)" : "var(--error)" }} />}
                />
              </div>

              {/* Energy Chart for Prosumer */}
              <div className="chart-wrap" style={{ marginBottom: "1rem" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={energyHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(64,72,87,0.3)" />
                    <XAxis dataKey="t" hide />
                    <YAxis domain={["auto", "auto"]} tick={{ fill: "var(--on-surface-dim)", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "rgba(15,26,42,0.95)", border: "1px solid rgba(64,72,87,0.5)", borderRadius: "10px", color: "var(--on-surface)" }} />
                    <Line type="monotone" dataKey="gen" stroke="var(--secondary)" strokeWidth={2} dot={false} name="Generation" />
                    <Line type="monotone" dataKey="con" stroke="var(--primary)"   strokeWidth={2} dot={false} name="Consumption" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                <button disabled={netSurplus <= 0} onClick={() => setBroadcastOpen(true)} className="btn btn-amber">
                  <Zap style={{ width: "1rem" }} /> Transmit {netSurplus > 0 ? netSurplus.toFixed(2) : "0.00"} kW
                </button>
                {communityStats && (
                  <span style={{ fontSize: "0.8rem", color: "var(--on-surface-dim)", display: "flex", alignItems: "center", gap: "5px" }}>
                    AI Dynamic Price: <strong className="glow-amber">{communityStats.dynamicPrice} $TET/kW</strong>
                  </span>
                )}
              </div>

              {/* My Listings */}
              <div style={{ marginTop: "1.4rem" }}>
                <h3 className="font-space" style={{ color: "var(--on-surface-dim)", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.8rem" }}>
                  My Active Listings
                </h3>
                {myListings.length === 0 ? (
                  <p style={{ color: "var(--on-surface-dim)", fontSize: "0.88rem" }}>No active listings. Broadcast to create one.</p>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.8rem" }}>
                    {myListings.map((item) => (
                      <div key={item.id} className="glass-card">
                        <p style={{ fontWeight: 700, color: "var(--secondary)", margin: "0 0 4px" }}>{item.availableKw.toFixed(2)} kW</p>
                        <p style={{ fontSize: "0.8rem", color: "var(--on-surface-dim)", margin: "0 0 8px" }}>{item.pricePerKw} $TET/kW</p>
                        <span className="co2-badge"><Leaf style={{ width: "11px" }} />{(item.availableKw * CO2_PER_KWH).toFixed(2)} kg CO₂</span>
                        <button onClick={() => deleteListing(item.id)} className="btn btn-danger" style={{ marginTop: "0.7rem", width: "100%", justifyContent: "center" }}>
                          <Trash2 style={{ width: "0.9rem" }} /> Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* CONSUMER — Marketplace */}
          {isConsumer && (
            <div className="panel">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem", marginBottom: "1rem" }}>
                <h2 className="font-space" style={{ fontSize: "1.4rem", color: "var(--primary)", margin: 0 }}>
                  ⚡ P2P Marketplace
                </h2>
                <div style={{ fontSize: "0.8rem", color: "var(--on-surface-dim)" }}>
                  Payment token: <span className="font-orbitron glow-amber">{user.paymentToken}</span>
                </div>
              </div>

              {/* Grid vs P2P comparison */}
              <div style={{ display: "flex", gap: "0.7rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                <span className="badge badge-red">🏭 Grid Tariff: ₹8-12/kWh</span>
                <span className="badge badge-green">
                  🌿 P2P Price: {communityStats ? `${communityStats.dynamicPrice} $TET/kW` : "~9 $TET/kW"}
                </span>
                <span className="badge badge-cyan">⚡ No middleman</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.6rem", marginBottom: "1rem" }}>
                <input
                  className="input-ghost"
                  value={marketQuery}
                  onChange={(e) => setMarketQuery(e.target.value)}
                  placeholder="Search seller or house"
                />
                <input
                  className="input-ghost"
                  type="number"
                  min="0"
                  step="0.1"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  placeholder="Max price ($TET/kW)"
                />
                <select className="input-ghost" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="newest">Sort: Latest</option>
                  <option value="price-asc">Sort: Price Low → High</option>
                  <option value="price-desc">Sort: Price High → Low</option>
                  <option value="energy-desc">Sort: Energy High → Low</option>
                </select>
              </div>

              <p style={{ margin: "0 0 1rem", fontSize: "0.75rem", color: "var(--on-surface-dim)" }}>
                Showing {filteredListings.length} of {listings.length} listings
              </p>

              {filteredListings.length === 0 ? (
                <p style={{ color: "var(--on-surface-dim)" }}>
                  {listings.length === 0
                    ? "No active listings right now. Wait for prosumers to broadcast."
                    : "No listings matched your filters. Try resetting search or price cap."}
                </p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))", gap: "1rem" }}>
                  {filteredListings.map((item) => {
                    const qty = Number(quantityMap[item.id] || item.availableKw);
                    const total = Number((qty * item.pricePerKw).toFixed(2));
                    const co2 = Number((qty * CO2_PER_KWH).toFixed(3));
                    const busy = busyId === item.id;
                    return (
                      <div key={item.id} className="market-card">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.6rem" }}>
                          <div>
                            <p style={{ fontWeight: 700, margin: "0 0 2px", color: "var(--on-surface)", fontSize: "0.95rem" }}>
                              {item.sellerName}
                            </p>
                            <p style={{ fontSize: "0.78rem", color: "var(--on-surface-dim)", margin: 0 }}>{item.sellerHouse}</p>
                          </div>
                          <span className="badge badge-amber">{item.pricePerKw} $TET/kW</span>
                        </div>
                        <div style={{ display: "flex", gap: "0.6rem", marginBottom: "0.7rem", flexWrap: "wrap" }}>
                          <span className="badge badge-cyan">Available: {item.availableKw.toFixed(2)} kW</span>
                          <span className="co2-badge"><Leaf style={{ width: "11px" }} />&nbsp;{item.co2IfBought} kg CO₂ if bought</span>
                        </div>
                        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.8rem" }}>
                          <label style={{ fontSize: "0.78rem", color: "var(--on-surface-dim)", whiteSpace: "nowrap" }}>Buy kW:</label>
                          <input
                            type="number" className="input-ghost"
                            min="0.01" max={item.availableKw} step="0.01"
                            value={quantityMap[item.id] ?? item.availableKw}
                            onChange={(e) => setQuantityMap((p) => ({ ...p, [item.id]: e.target.value }))}
                            style={{ width: "90px" }}
                          />
                          <span style={{ fontSize: "0.78rem", color: "var(--tertiary)", whiteSpace: "nowrap" }}>= {co2} kg CO₂</span>
                        </div>
                        <button disabled={busy} onClick={() => openPayment(item)} className="btn btn-cyan" style={{ width: "100%", justifyContent: "center" }}>
                          {busy ? (
                            <><LoaderCircle style={{ width: "1rem", animation: "spin 1s linear infinite" }} /> {buyStage}</>
                          ) : (
                            `💳 Pay ${total.toFixed(2)} $TET`
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ════════ COMMUNITY TAB ════════ */}
      {activeTab === "community" && (
        <div style={{ position: "relative", zIndex: 10, display: "flex", flexDirection: "column", gap: "1.2rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.2rem" }}>

            {/* Environmental Impact */}
            <div className="panel">
              <h2 className="font-space" style={{ fontSize: "1.3rem", color: "var(--tertiary)", margin: "0 0 1.2rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Leaf /> Environmental Impact
              </h2>
              {communityStats ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <ImpactRow icon="☀️" label="Total Solar Energy Traded" value={`${communityStats.totalEnergyKwh} kWh`} color="glow-amber" />
                  <ImpactRow icon="🌿" label="Total CO₂ Offset" value={`${communityStats.totalCo2Kg} kg`} color="glow-green" />
                  <ImpactRow icon="🌲" label="Trees Equivalent" value={`${communityStats.treesEquivalent} trees`} color="glow-green" />
                  <ImpactRow icon="⚡" label="Available P2P Supply" value={`${communityStats.totalAvailableKw} kW`} color="glow-cyan" />
                  <ImpactRow icon="💰" label="Est. Grid Savings" value={`₹${communityStats.gridSavingsRupees}`} color="glow-amber" />
                  <div style={{ marginTop: "0.5rem", padding: "0.9rem", borderRadius: "14px", background: "rgba(155,255,206,0.06)", border: "1px solid rgba(155,255,206,0.15)" }}>
                    <p style={{ fontSize: "0.78rem", color: "var(--on-surface-dim)", margin: 0 }}>
                      🌍 <strong style={{ color: "var(--tertiary)" }}>Vidyut Setu's Impact</strong>: Every kWh traded peer-to-peer avoids 0.82 kg of CO₂ compared to coal-based grid power in India.
                      At scale, this network can decarbonize India's residential sector one rooftop at a time.
                    </p>
                  </div>
                </div>
              ) : (
                <p style={{ color: "var(--on-surface-dim)" }}>Loading stats...</p>
              )}
            </div>

            {/* Carbon Leaderboard */}
            <div className="panel">
              <h2 className="font-space" style={{ fontSize: "1.3rem", color: "var(--secondary)", margin: "0 0 1.2rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Star /> Carbon Leaderboard
              </h2>
              {communityStats?.leaderboard?.length > 0 ? (
                <div>
                  {communityStats.leaderboard.map((entry, i) => (
                    <div key={entry.houseId} className="leaderboard-row">
                      <span className={`leaderboard-rank ${i < 3 ? "top" : ""}`}>
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                      </span>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontWeight: 600, fontSize: "0.88rem" }}>{entry.name}</p>
                        <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--on-surface-dim)" }}>{entry.kw} kW traded</p>
                      </div>
                      <span className="badge badge-green"><Leaf style={{ width: "11px" }} /> {entry.co2Kg} kg</span>
                    </div>
                  ))}
                  <p style={{ fontSize: "0.72rem", color: "var(--on-surface-dim)", marginTop: "0.8rem", textAlign: "center" }}>
                    Ranked by total CO₂ offset through P2P trading
                  </p>
                </div>
              ) : (
                <p style={{ color: "var(--on-surface-dim)" }}>No trades yet. Make the first trade!</p>
              )}
            </div>

            {/* Network Stats */}
            <div className="panel">
              <h2 className="font-space" style={{ fontSize: "1.3rem", color: "var(--primary)", margin: "0 0 1.2rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <TrendingUp /> Network Stats
              </h2>
              {communityStats ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                  <StatRow label="Active Prosumers" value={`${communityStats.activeProsumers} houses`} />
                  <StatRow label="Total Trades Settled" value={communityStats.totalTrades} />
                  <StatRow label="AI Dynamic Price" value={`${communityStats.dynamicPrice} $TET/kW`} />
                  <StatRow label="Grid Tariff (India avg)" value="₹8–12 / kWh" sub="(fossil fuel)" />
                  <div style={{ marginTop: "0.5rem", borderTop: "1px solid rgba(64,72,87,0.3)", paddingTop: "0.8rem" }}>
                    <p style={{ fontSize: "0.75rem", color: "var(--on-surface-dim)", margin: 0 }}>
                      💡 AI pricing adjusts every broadcast based on supply & demand pressure, ensuring fair market rates for both prosumers and consumers.
                    </p>
                  </div>
                </div>
              ) : (
                <p style={{ color: "var(--on-surface-dim)" }}>Loading...</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════════ LEDGER TAB ════════ */}
      {activeTab === "ledger" && (
        <div className="panel" style={{ position: "relative", zIndex: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem", marginBottom: "1rem" }}>
            <h2 className="font-space" style={{ fontSize: "1.3rem", color: "var(--secondary)", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
              🔗 Immutable Ledger
            </h2>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <span className="badge badge-green">Tamper-Evident Hash Chain</span>
              <span className="badge badge-cyan">Idempotent Settlements</span>
            </div>
          </div>
          <p style={{ fontSize: "0.78rem", color: "var(--on-surface-dim)", marginBottom: "1rem" }}>
            Click any row to inspect. Download a <strong style={{ color: "var(--tertiary)" }}>Green Energy Certificate (REC)</strong> per trade.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>TxnHash</th>
                  <th>Payment ID</th>
                  <th>Route</th>
                  <th>Energy</th>
                  <th>Amount</th>
                  <th>CO₂ Saved</th>
                  <th>Integrity</th>
                  <th>Status</th>
                  <th>Certificate</th>
                </tr>
              </thead>
              <tbody>
                {ledgerRows.length === 0 ? (
                  <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--on-surface-dim)", padding: "2rem" }}>No trades yet.</td></tr>
                ) : ledgerRows.map((row) => (
                  <tr key={row.id} onClick={() => setSelectedTxn(row)}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--primary)" }}>{row.hash}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--on-surface-dim)" }}>{row.paymentId}</td>
                    <td style={{ fontSize: "0.78rem" }}>{row.fromTo}</td>
                    <td className="glow-amber" style={{ fontWeight: 700 }}>{row.energyKw} kW</td>
                    <td className="glow-cyan" style={{ fontWeight: 700 }}>{row.amountTet} $TET</td>
                    <td><span className="co2-badge"><Leaf style={{ width: "11px" }} /> {row.co2SavedKg} kg</span></td>
                    <td>
                      <span className={`badge ${row.integrity === "Verified" ? "badge-green" : "badge-red"}`}>
                        {row.integrity === "Verified" ? "✅ Verified" : "⚠️ Tampered"}
                      </span>
                    </td>
                    <td><span className="badge badge-cyan">{row.status}</span></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => downloadCertificate(row.id)} className="btn btn-green" style={{ padding: "0.3rem 0.6rem", fontSize: "0.72rem" }} disabled={certLoading}>
                        <Download style={{ width: "0.8rem" }} /> REC
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════ MODALS ═══════ */}

      {/* Broadcast Modal */}
      {broadcastOpen && (
        <div className="modal-overlay">
          <div className="modal-box">
            <h4 className="font-space" style={{ fontSize: "1.3rem", margin: "0 0 0.8rem", color: "var(--secondary)" }}>
              📡 Broadcast Energy Packet
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem", marginBottom: "1.2rem" }}>
              <p style={{ margin: 0 }}>Broadcasting: <strong className="glow-amber">{netSurplus.toFixed(2)} kW</strong></p>
              <p style={{ margin: 0 }}>AI Dynamic Price: <strong className="glow-amber">{communityStats?.dynamicPrice ?? 9} $TET/kW</strong></p>
              <p style={{ margin: 0 }}>Total Value: <strong className="glow-cyan">{((communityStats?.dynamicPrice ?? 9) * netSurplus).toFixed(2)} $TET</strong></p>
              <p style={{ margin: 0 }}>CO₂ Potential: <strong className="glow-green">{(netSurplus * CO2_PER_KWH).toFixed(2)} kg</strong></p>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
              <button onClick={() => setBroadcastOpen(false)} className="btn">Cancel</button>
              <button onClick={submitBroadcast} className="btn btn-amber" disabled={broadcastState === "loading"}>
                {broadcastState === "loading" ? <><LoaderCircle style={{ width: "1rem", animation: "spin 1s linear infinite" }} /> Publishing...</> :
                  broadcastState === "success" ? "Published ✅" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {paymentOpen && buyIntent && (
        <div className="modal-overlay">
          <div className="modal-box">
            <h4 className="font-space" style={{ fontSize: "1.3rem", margin: "0 0 0.8rem", color: "var(--primary)" }}>
              🔒 Payment Verification
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
              <p style={{ margin: 0 }}>Buying: <strong className="glow-amber">{buyIntent.desiredKw.toFixed(2)} kW</strong> from {buyIntent.listing.sellerHouse}</p>
              <p style={{ margin: 0 }}>Total: <strong className="glow-cyan">{(buyIntent.desiredKw * buyIntent.listing.pricePerKw).toFixed(2)} $TET</strong></p>
              <p style={{ margin: 0 }}>CO₂ offset: <strong className="glow-green">{(buyIntent.desiredKw * CO2_PER_KWH).toFixed(3)} kg</strong></p>
            </div>
            <label style={{ fontSize: "0.82rem", color: "var(--on-surface-dim)", display: "block", marginBottom: "0.5rem" }}>
              Enter your 6-digit bank token
            </label>
            <input
              type="password" maxLength={6} inputMode="numeric" className="input-ghost"
              value={payToken}
              onChange={(e) => setPayToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="● ● ● ● ● ●"
              style={{ letterSpacing: "0.3em", textAlign: "center", fontSize: "1.1rem" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", marginTop: "1.2rem" }}>
              <button onClick={() => setPaymentOpen(false)} className="btn">Cancel</button>
              <button onClick={confirmPaymentAndBuy} className="btn btn-cyan" disabled={payToken.length !== 6}>
                <ShieldCheck style={{ width: "1rem" }} /> Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Detail Modal */}
      {selectedTxn && (
        <div className="modal-overlay" onClick={() => setSelectedTxn(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h4 className="font-space" style={{ fontSize: "1.2rem", margin: 0, color: "var(--primary)" }}>Transaction Details</h4>
              <button onClick={() => setSelectedTxn(null)} className="btn" style={{ padding: "0.3rem" }}><X style={{ width: "1rem" }} /></button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
              <Detail label="TxnHash" value={selectedTxn.hash} mono />
              <Detail label="PaymentID" value={selectedTxn.paymentId} mono />
              <Detail label="Route" value={selectedTxn.fromTo} />
              <Detail label="Energy" value={`${selectedTxn.energyKw} kW`} color="glow-amber" />
              <Detail label="Amount" value={`${selectedTxn.amountTet} $TET`} color="glow-cyan" />
              <Detail label="CO₂ Saved" value={`${selectedTxn.co2SavedKg} kg`} color="glow-green" />
              <Detail label="Integrity" value={selectedTxn.integrity} color={selectedTxn.integrity === "Verified" ? "glow-green" : "glow-red"} />
              <Detail label="Chain Hash" value={`${selectedTxn.chainHash?.slice(0, 26)}...`} mono />
              <Detail label="Status" value={selectedTxn.status} />
            </div>
            <div style={{ marginTop: "1rem", display: "flex", gap: "0.6rem" }}>
              <button onClick={() => { downloadCertificate(selectedTxn.id); setSelectedTxn(null); }} className="btn btn-green">
                <Download style={{ width: "0.9rem" }} /> Get Green Certificate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Green Certificate Modal */}
      {certData && (
        <div className="modal-overlay" onClick={() => setCertData(null)}>
          <div className="modal-box" style={{ maxWidth: "580px" }} onClick={(e) => e.stopPropagation()}>
            <div className="cert-box">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.2rem" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <Award style={{ color: "var(--tertiary)", width: "1.5rem" }} />
                    <span className="font-orbitron" style={{ fontSize: "1rem", color: "var(--tertiary)" }}>GREEN ENERGY CERTIFICATE</span>
                  </div>
                  <p style={{ margin: "0.3rem 0 0", fontSize: "0.72rem", color: "var(--on-surface-dim)", letterSpacing: "0.05em" }}>
                    RENEWABLE ENERGY CERTIFICATE (REC)
                  </p>
                </div>
                <button onClick={() => setCertData(null)} className="btn" style={{ padding: "0.3rem" }}><X style={{ width: "0.9rem" }} /></button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.7rem 1.5rem", fontSize: "0.82rem", marginBottom: "1rem" }}>
                <Detail label="Certificate ID" value={certData.paymentId} mono />
                <Detail label="Issued At" value={new Date(certData.issuedAt).toLocaleString()} />
                <Detail label="Seller" value={certData.sellerHouse} />
                <Detail label="Buyer" value={certData.buyerHouse} />
                <Detail label="Energy Traded" value={`${certData.energyKwh} kWh`} color="glow-amber" />
                <Detail label="Price" value={`${certData.pricePerKwh} $TET/kWh`} color="glow-cyan" />
                <Detail label="CO₂ Offset" value={`${certData.co2SavedKg} kg`} color="glow-green" />
                <Detail label="Trees Equiv." value={`${certData.treesEquivalent} trees`} color="glow-green" />
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--on-surface-dim)", borderTop: "1px solid rgba(155,255,206,0.15)", paddingTop: "0.8rem", marginBottom: "1rem" }}>
                <p style={{ margin: "0 0 4px" }}>🌍 {certData.note}</p>
                <p style={{ margin: 0 }}>Issuer: <strong style={{ color: "var(--tertiary)" }}>{certData.issuer}</strong> · Hash: <code style={{ fontSize: "0.68rem" }}>{certData.hash?.slice(0, 20)}...</code></p>
              </div>
              <button onClick={downloadCertAsJSON} className="btn btn-green" style={{ width: "100%", justifyContent: "center" }}>
                <Download style={{ width: "1rem" }} /> Download REC (.json)
              </button>
            </div>
          </div>
        </div>
      )}

      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}

/* ───── Sub-components ───── */

function Toasts({ toasts, dismiss }) {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span style={{ fontSize: "1.2rem", lineHeight: 1 }}>{TOAST_ICONS[t.type]}</span>
          <div style={{ flex: 1 }}>
            <p className="toast-title" style={{ margin: 0 }}>{t.title}</p>
            {t.body && <p className="toast-body" style={{ margin: 0 }}>{t.body}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} style={{ background: "none", border: "none", color: "var(--on-surface-dim)", cursor: "pointer", padding: "2px" }}>
            <X style={{ width: "14px" }} />
          </button>
        </div>
      ))}
    </div>
  );
}

function MeterCard({ label, value, sub, icon, color }) {
  return (
    <div className="glass-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <span style={{ fontSize: "0.78rem", color: "var(--on-surface-dim)", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "Space Grotesk" }}>{label}</span>
        {icon && <span style={{ opacity: 0.9 }}>{icon}</span>}
      </div>
      <p className={`font-orbitron ${color}`} style={{ fontSize: "1.8rem", margin: 0, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: "0.72rem", color: "var(--on-surface-dim)", margin: "0.3rem 0 0" }}>{sub}</p>}
    </div>
  );
}

function ImpactRow({ icon, label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0", borderBottom: "1px solid rgba(64,72,87,0.25)" }}>
      <span style={{ fontSize: "0.82rem", color: "var(--on-surface-dim)" }}>{icon} {label}</span>
      <span className={`font-space ${color}`} style={{ fontWeight: 700, fontSize: "0.92rem" }}>{value}</span>
    </div>
  );
}

function StatRow({ label, value, sub }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0", borderBottom: "1px solid rgba(64,72,87,0.2)" }}>
      <div>
        <span style={{ fontSize: "0.82rem", color: "var(--on-surface-dim)" }}>{label}</span>
        {sub && <span style={{ fontSize: "0.7rem", color: "var(--error)", marginLeft: "0.5rem" }}>{sub}</span>}
      </div>
      <span className="font-space" style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--on-surface)" }}>{value}</span>
    </div>
  );
}

function Detail({ label, value, color, mono }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "baseline" }}>
      <span style={{ fontSize: "0.75rem", color: "var(--on-surface-dim)", whiteSpace: "nowrap", fontFamily: "Space Grotesk", letterSpacing: "0.04em" }}>{label}</span>
      <span className={color || ""} style={{ fontWeight: 600, fontSize: "0.82rem", textAlign: "right", fontFamily: mono ? "monospace" : undefined, wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}
