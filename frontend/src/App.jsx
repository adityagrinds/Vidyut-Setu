import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Home,
  LoaderCircle,
  ShieldCheck,
  SunMedium,
  Trash2,
  Triangle,
  Zap,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5055/api";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const makeIdempotencyKey = () => `vidyut-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const demoAccounts = {
  prosumer: { email: "prosumer@sauryasetu.local", password: "123456" },
  consumer: { email: "consumer@sauryasetu.local", password: "123456" },
};

function App() {
  const [booting, setBooting] = useState(true);
  const [token, setToken] = useState("");
  const [user, setUser] = useState(null);
  const [listings, setListings] = useState([]);
  const [ledgerRows, setLedgerRows] = useState([]);
  const [generationKw, setGenerationKw] = useState(4.24);
  const [consumptionKw, setConsumptionKw] = useState(2.1);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastState, setBroadcastState] = useState("idle");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [buyIntent, setBuyIntent] = useState(null);
  const [paymentTokenInput, setPaymentTokenInput] = useState("");
  const [buyStage, setBuyStage] = useState("");
  const [busyListingId, setBusyListingId] = useState("");
  const [walletFlash, setWalletFlash] = useState(false);
  const [successOverlay, setSuccessOverlay] = useState(null);
  const [selectedTxn, setSelectedTxn] = useState(null);
  const [quantityMap, setQuantityMap] = useState({});

  const netSurplus = useMemo(
    () => Number((generationKw - consumptionKw).toFixed(2)),
    [generationKw, consumptionKw]
  );

  const isProsumer = user?.role === "prosumer";
  const isConsumer = user?.role === "consumer";

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  useEffect(() => {
    const timer = setTimeout(() => setBooting(false), 1900);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const meter = setInterval(() => {
      setGenerationKw((prev) => Number(Math.max(2.0, Math.min(7.1, prev + (Math.random() * 0.7 - 0.2))).toFixed(2)));
      setConsumptionKw((prev) => Number(Math.max(1.1, Math.min(5.9, prev + (Math.random() * 0.55 - 0.2))).toFixed(2)));
    }, 3000);

    return () => clearInterval(meter);
  }, []);

  const loginDemo = async (role) => {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(demoAccounts[role]),
    });

    if (!response.ok) {
      alert("Login failed. Run backend and seed first.");
      return;
    }

    const data = await response.json();
    setToken(data.token);
    setUser(data.user);
  };

  const refreshWallet = async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/wallet/me`, { headers: authHeaders });
    if (!res.ok) return;
    const data = await res.json();
    setUser(data.user);
  };

  const refreshListings = async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/listings`, { headers: authHeaders });
    if (!res.ok) return;
    const data = await res.json();
    setListings(data.listings);
  };

  const refreshLedger = async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/ledger/recent`, { headers: authHeaders });
    if (!res.ok) return;
    const data = await res.json();
    setLedgerRows(data.rows);
  };

  const refreshAll = async () => {
    await Promise.all([refreshWallet(), refreshListings(), refreshLedger()]);
  };

  useEffect(() => {
    if (!token) return;
    refreshAll();
    const timer = setInterval(refreshAll, 5000);
    return () => clearInterval(timer);
  }, [token]);

  const submitBroadcast = async () => {
    try {
      setBroadcastState("loading");
      const response = await fetch(`${API_BASE}/broadcast`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ surplusKw: netSurplus }),
      });

      if (!response.ok) {
        const failure = await response.json();
        throw new Error(failure.message || "Broadcast failed");
      }

      await delay(700);
      setBroadcastState("success");
      await refreshListings();
    } catch (error) {
      alert(error.message || "Unable to broadcast");
      setBroadcastState("idle");
    }
  };

  const deleteListing = async (listingId) => {
    const response = await fetch(`${API_BASE}/listings/${listingId}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    const result = await response.json();
    if (!response.ok) {
      alert(result.message || "Unable to delete listing");
      return;
    }
    await refreshListings();
  };

  const openPayment = (listing) => {
    const desiredKw = Number(quantityMap[listing.id] || listing.availableKw);
    if (!desiredKw || desiredKw <= 0) {
      alert("Enter valid kW quantity");
      return;
    }

    setBuyIntent({ listing, desiredKw });
    setPaymentTokenInput("");
    setPaymentOpen(true);
  };

  const confirmPaymentAndBuy = async () => {
    if (!buyIntent) return;

    try {
      setBusyListingId(buyIntent.listing.id);
      setBuyStage("Initializing Smart Contract...");
      await delay(1500);

      setBuyStage("Verifying Thore Ledger...");
      await delay(1000);

      setBuyStage("Executing Atomic Swap...");
      await delay(1000);

      const response = await fetch(`${API_BASE}/trade`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "x-idempotency-key": makeIdempotencyKey(),
        },
        body: JSON.stringify({
          listingId: buyIntent.listing.id,
          requestedKw: buyIntent.desiredKw,
          paymentToken: paymentTokenInput,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Settlement failed");
      }

      setWalletFlash(true);
      setSuccessOverlay({
        title: "Payment Confirmed",
        text: `${result.deductedTet.toFixed(2)} $TET deducted. ${result.energyKw.toFixed(2)} kW sync initiated.`,
        paymentId: result.paymentId,
      });

      setTimeout(() => setWalletFlash(false), 420);
      setTimeout(() => setSuccessOverlay(null), 2400);
      setPaymentOpen(false);
      setBuyIntent(null);
      await refreshAll();
    } catch (error) {
      alert(error.message || "Payment failed");
    } finally {
      setBuyStage("");
      setBusyListingId("");
    }
  };

  const myListings = useMemo(
    () => listings.filter((item) => item.sellerId === user?.id),
    [listings, user?.id]
  );

  if (booting) {
    return (
      <div className="boot-screen">
        <div className="boot-core">
          <Triangle className="h-10 w-10 text-amber-300" />
          <h1 className="boot-title">Vidyut Setu</h1>
          <p className="boot-sub">Booting decentralized energy mesh...</p>
          <div className="boot-bar">
            <span className="boot-fill" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="relative min-h-screen overflow-hidden p-5 sm:p-8">
        <div className="aurora-bg" />
        <div className="grid-lines" />
        <div className="depth-orb depth-orb-a" />
        <div className="depth-orb depth-orb-b" />
        <div className="scene-vignette" />
        <main className="relative z-10 mx-auto max-w-5xl">
          <header className="mb-8 text-center">
            <h1 className="logo-text text-5xl sm:text-6xl">Vidyut Setu</h1>
            <p className="mt-3 text-cyan-100/80">Choose dashboard to enter live prototype</p>
          </header>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <button onClick={() => loginDemo("prosumer")} className="role-card">
              <SunMedium className="mb-3 h-10 w-10 text-amber-200" />
              <h2 className="font-display text-2xl">Prosumer Command Deck</h2>
              <p className="mt-2 text-cyan-100/75">Manage generation, publish packets, control listing lifecycle.</p>
            </button>
            <button onClick={() => loginDemo("consumer")} className="role-card">
              <Banknote className="mb-3 h-10 w-10 text-cyan-200" />
              <h2 className="font-display text-2xl">Consumer Settlement Deck</h2>
              <p className="mt-2 text-cyan-100/75">Buy exact energy with token verified dummy payment rail.</p>
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-5 sm:px-7">
      <div className="aurora-bg" />
      <div className="grid-lines" />
      <div className="depth-orb depth-orb-a" />
      <div className="depth-orb depth-orb-b" />
      <div className="scene-vignette" />

      <header className="relative z-10 mb-6 rounded-3xl border border-white/20 bg-slate-950/55 p-4 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="logo-core">
              <Zap className="h-6 w-6 text-amber-100" />
            </div>
            <div>
              <p className="logo-text">Vidyut Setu</p>
              <p className="text-sm text-cyan-100/75">
                {isProsumer ? "Prosumer Dashboard" : "Consumer Dashboard"} | House #{user.houseId}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-right">
            <p className="text-xs text-cyan-100/70">Wallet</p>
            <p className={`font-display text-2xl ${walletFlash ? "animate-flash-red" : ""}`}>
              {Number(user.walletBalance || 0).toFixed(2)} $TET
            </p>
          </div>

          <button
            onClick={() => {
              setToken("");
              setUser(null);
            }}
            className="neo-btn danger"
          >
            Switch User
          </button>
        </div>
      </header>

      {isProsumer && (
        <section className="relative z-10 mb-6 rounded-3xl border border-white/20 bg-slate-950/55 p-5 backdrop-blur-xl">
          <div className="orbit-glow" />
          <h2 className="mb-4 font-display text-2xl text-amber-100">Live Orbit</h2>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="glass-card">
              <div className="mb-2 flex items-center justify-between text-cyan-100/80">
                <span>Generation</span>
                <SunMedium className="h-5 w-5 animate-spin-slow text-yellow-300" />
              </div>
              <p className="font-display text-3xl">{generationKw.toFixed(2)} kW</p>
            </div>
            <div className="glass-card">
              <div className="mb-2 flex items-center justify-between text-cyan-100/80">
                <span>Consumption</span>
                <Home className="h-5 w-5 text-cyan-300" />
              </div>
              <p className="font-display text-3xl">{consumptionKw.toFixed(2)} kW</p>
            </div>
            <div className={`glass-card ${netSurplus >= 0 ? "border-green-400/70 text-green-300" : "border-red-500/70 text-red-300"}`}>
              <p className="mb-2 text-cyan-100/80">Net Surplus</p>
              <p className="font-display text-3xl">{netSurplus >= 0 ? "+" : ""}{netSurplus.toFixed(2)} kW</p>
              <p className="text-sm text-cyan-100/70">{netSurplus >= 0 ? "Surplus" : "Grid Draw"}</p>
            </div>
          </div>

          <div className="mt-5">
            <button
              disabled={netSurplus <= 0}
              onClick={() => setBroadcastOpen(true)}
              className="neo-btn warm text-base disabled:opacity-40"
            >
              Transmit {netSurplus > 0 ? netSurplus.toFixed(2) : "0.00"} kW
            </button>
          </div>

          <div className="mt-6 rounded-2xl border border-white/15 bg-white/5 p-4">
            <h3 className="mb-3 font-display text-xl text-cyan-100">My Active Listings</h3>
            {myListings.length === 0 && <p className="text-cyan-100/70">No listings available.</p>}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {myListings.map((item) => (
                <div key={item.id} className="glass-card">
                  <p>{item.availableKw.toFixed(2)} kW | {item.pricePerKw} $TET/kW</p>
                  <button onClick={() => deleteListing(item.id)} className="neo-btn danger mt-3">
                    <Trash2 className="h-4 w-4" /> Delete Listing
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {isConsumer && (
        <section className="relative z-10 mb-6 rounded-3xl border border-white/20 bg-slate-950/55 p-5 backdrop-blur-xl">
          <h2 className="mb-2 font-display text-2xl text-cyan-100">Consumer Marketplace</h2>
          <p className="mb-4 text-sm text-cyan-100/75">Demo bank token for this account: <span className="font-display text-amber-200">{user.paymentToken}</span></p>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {listings.map((item) => {
              const qty = Number(quantityMap[item.id] || item.availableKw);
              const total = Number((qty * item.pricePerKw).toFixed(2));
              const busy = busyListingId === item.id;
              return (
                <div key={item.id} className="market-card">
                  <p>Seller: {item.sellerHouse}</p>
                  <p>Available: {item.availableKw.toFixed(2)} kW</p>
                  <p>Price: {item.pricePerKw} $TET/kW</p>

                  <div className="mt-3 flex items-center gap-2">
                    <label className="text-sm text-cyan-100/70">Buy kW</label>
                    <input
                      type="number"
                      min="0.01"
                      max={item.availableKw}
                      step="0.01"
                      value={quantityMap[item.id] ?? item.availableKw}
                      onChange={(event) =>
                        setQuantityMap((prev) => ({
                          ...prev,
                          [item.id]: event.target.value,
                        }))
                      }
                      className="w-28 rounded-lg border border-white/25 bg-slate-900/60 px-2 py-1"
                    />
                  </div>

                  <button
                    disabled={busy}
                    onClick={() => openPayment(item)}
                    className="neo-btn cool mt-4 w-full justify-center disabled:opacity-40"
                  >
                    {busy ? (
                      <span className="inline-flex items-center gap-2">
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        {buyStage}
                      </span>
                    ) : (
                      `Proceed to Payment (${total.toFixed(2)} $TET)`
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="relative z-10 rounded-3xl border border-white/20 bg-slate-950/55 p-5 backdrop-blur-xl">
        <h3 className="mb-3 font-display text-xl text-amber-100">Vidyut Setu Immutable Ledger</h3>
        <p className="mb-4 text-sm text-cyan-100/70">Click any transaction to inspect details.</p>

        <div className="overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-cyan-100/70">
              <tr>
                <th className="px-3 py-2">Txn Hash</th>
                <th className="px-3 py-2">Payment ID</th>
                <th className="px-3 py-2">Timestamp</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Energy</th>
                <th className="px-3 py-2">Integrity</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {ledgerRows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedTxn(row)}
                  className="cursor-pointer border-t border-white/10 transition hover:bg-cyan-300/10"
                >
                  <td className="px-3 py-2 font-mono">{row.hash}</td>
                  <td className="px-3 py-2 font-mono text-cyan-300">{row.paymentId}</td>
                  <td className="px-3 py-2">{row.timestamp}</td>
                  <td className="px-3 py-2 text-green-300">{row.amountTet.toFixed(2)} $TET</td>
                  <td className="px-3 py-2 text-amber-300">{row.energyKw.toFixed(2)} kW</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-1 text-xs ${row.integrity === "Verified" ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>
                      {row.integrity}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded-full border border-green-300/60 bg-green-400/15 px-2 py-1 text-xs text-green-300">{row.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {broadcastOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/20 bg-slate-900/90 p-6 backdrop-blur-xl">
            <h4 className="mb-3 font-display text-2xl text-cyan-100">Broadcast Packet</h4>
            <p>You are broadcasting {netSurplus.toFixed(2)} kW.</p>
            <p>AI Suggested Dynamic Price: 9 $TET/kW.</p>
            <p>Total Value: {(netSurplus * 9).toFixed(2)} $TET.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setBroadcastOpen(false)} className="neo-btn">Close</button>
              <button onClick={submitBroadcast} className="neo-btn warm">
                {broadcastState === "loading" ? "Publishing..." : broadcastState === "success" ? "Published ✅" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentOpen && buyIntent && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/20 bg-slate-900/90 p-6 backdrop-blur-xl">
            <h4 className="mb-3 font-display text-2xl text-cyan-100">Payment Verification</h4>
            <p>Buying {buyIntent.desiredKw.toFixed(2)} kW from {buyIntent.listing.sellerHouse}</p>
            <p className="mb-3">Total: {(buyIntent.desiredKw * buyIntent.listing.pricePerKw).toFixed(2)} $TET</p>

            <label className="mb-2 block text-sm text-cyan-100/75">Enter 6-digit bank token</label>
            <input
              type="password"
              maxLength={6}
              inputMode="numeric"
              value={paymentTokenInput}
              onChange={(event) => setPaymentTokenInput(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-lg border border-white/25 bg-slate-900/60 px-3 py-2"
              placeholder="******"
            />

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setPaymentOpen(false)} className="neo-btn">Cancel</button>
              <button onClick={confirmPaymentAndBuy} className="neo-btn cool" disabled={paymentTokenInput.length !== 6}>
                <ShieldCheck className="h-4 w-4" /> Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedTxn && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/20 bg-slate-900/90 p-5 backdrop-blur-xl">
            <h4 className="mb-3 font-display text-xl text-cyan-100">Transaction Details</h4>
            <p>Txn Hash: {selectedTxn.hash}</p>
            <p>Payment ID: {selectedTxn.paymentId}</p>
            <p>Flow: {selectedTxn.fromTo}</p>
            <p>Amount: {selectedTxn.amountTet.toFixed(2)} $TET</p>
            <p>Energy: {selectedTxn.energyKw.toFixed(2)} kW</p>
            <p>Integrity: {selectedTxn.integrity}</p>
            <p>Chain Hash: {selectedTxn.chainHash?.slice(0, 22)}...</p>
            <p>Status: {selectedTxn.status}</p>
            <button onClick={() => setSelectedTxn(null)} className="neo-btn mt-4">Close</button>
          </div>
        </div>
      )}

      {successOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xl">
          <div className="text-center">
            <div className="text-8xl">✅</div>
            <p className="mt-2 font-display text-4xl">{successOverlay.title}</p>
            <p className="text-lg">{successOverlay.text}</p>
            <p className="mt-1 text-cyan-200">Payment ID: {successOverlay.paymentId}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
