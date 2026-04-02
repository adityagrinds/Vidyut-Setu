import express from "express";
import mongoose from "mongoose";
import { authRequired } from "../middleware/auth.js";
import { Listing } from "../models/Listing.js";
import { Transaction } from "../models/Transaction.js";
import { User } from "../models/User.js";
import { buildLedgerHash, GENESIS_HASH } from "../utils/ledgerHash.js";

const router = express.Router();
const CO2_PER_KWH = 0.82; // kg CO2 saved per kWh of solar vs coal grid
const normalizeKw = (value) => Number(Number(value).toFixed(2));

// Dynamic pricing formula: base + demand pressure
const computeDynamicPrice = async () => {
  const [liveListings, recentTrades] = await Promise.all([
    Listing.countDocuments({ status: { $in: ["live", "partial"] } }),
    Transaction.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 3600 * 1000) },
    }),
  ]);
  // Base 7 $TET, +1 per trade in last hour, max 15. Lower supply = higher price.
  const demandPressure = Math.min(recentTrades, 5);
  const supplyDiscount = Math.max(0, liveListings - 1) * 0.5;
  return Math.max(7, Math.min(15, 7 + demandPressure - supplyDiscount));
};

router.get("/wallet/me", authRequired, async (req, res) => {
  return res.json({
    user: {
      id: req.user._id,
      role: req.user.role,
      houseId: req.user.houseId,
      name: req.user.name,
      walletBalance: Number(req.user.walletBalance.toFixed(2)),
      paymentToken: req.user.role === "consumer" ? req.user.paymentToken : undefined,
    },
  });
});

router.get("/community/stats", authRequired, async (_req, res) => {
  try {
    const [txns, activeProsumers, listings] = await Promise.all([
      Transaction.find().lean(),
      User.countDocuments({ role: "prosumer" }),
      Listing.find({ status: { $in: ["live", "partial"] } }).lean(),
    ]);

    const totalEnergyKwh = txns.reduce((s, t) => s + t.energyKw, 0);
    const totalCo2Kg = txns.reduce((s, t) => s + (t.co2SavedKg || t.energyKw * CO2_PER_KWH), 0);
    const totalAmountTet = txns.reduce((s, t) => s + t.amountTet, 0);
    const totalAvailableKw = listings.reduce((s, l) => s + l.availableKw, 0);

    // Grid price in India ≈ ₹8/unit; $TET trades save the difference
    const gridPricePerKwh = 8;
    const avgTetPrice = totalEnergyKwh > 0 ? totalAmountTet / totalEnergyKwh : 9;
    const gridSavingsRupees = Math.max(0, (gridPricePerKwh - avgTetPrice) * totalEnergyKwh * 0.15);

    // Leaderboard: top co2 savers
    const userTotals = {};
    for (const t of txns) {
      const id = t.seller.toString();
      if (!userTotals[id]) userTotals[id] = { co2: 0, kw: 0 };
      userTotals[id].co2 += t.co2SavedKg || t.energyKw * CO2_PER_KWH;
      userTotals[id].kw += t.energyKw;
    }
    const sellerIds = Object.keys(userTotals);
    const sellers = await User.find({ _id: { $in: sellerIds } }, "houseId name walletBalance").lean();
    const leaderboard = sellers
      .map((s) => ({
        houseId: s.houseId,
        name: s.name,
        co2Kg: Number((userTotals[s._id.toString()]?.co2 || 0).toFixed(2)),
        kw: Number((userTotals[s._id.toString()]?.kw || 0).toFixed(2)),
      }))
      .sort((a, b) => b.co2Kg - a.co2Kg)
      .slice(0, 5);

    return res.json({
      totalEnergyKwh: Number(totalEnergyKwh.toFixed(2)),
      totalCo2Kg: Number(totalCo2Kg.toFixed(2)),
      treesEquivalent: Number((totalCo2Kg / 21).toFixed(1)),
      activeProsumers,
      totalTrades: txns.length,
      totalAvailableKw: Number(totalAvailableKw.toFixed(2)),
      gridSavingsRupees: Number(gridSavingsRupees.toFixed(0)),
      dynamicPrice: Number((await computeDynamicPrice()).toFixed(1)),
      leaderboard,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch community stats" });
  }
});

router.post("/broadcast", authRequired, async (req, res) => {
  try {
    if (req.user.role !== "prosumer") {
      return res.status(403).json({ message: "Only prosumers can broadcast" });
    }

    const { surplusKw } = req.body;
    const safeSurplus = Number(surplusKw || 0);

    if (safeSurplus <= 0) {
      return res.status(400).json({ message: "Surplus must be positive" });
    }

    const dynamicPrice = await computeDynamicPrice();

    const listing = await Listing.create({
      seller: req.user._id,
      availableKw: Number(safeSurplus.toFixed(2)),
      pricePerKw: dynamicPrice,
    });

    // Emit socket event if io is available
    const io = req.app.get("io");
    if (io) io.emit("listing:new", { sellerId: req.user._id, availableKw: listing.availableKw, pricePerKw: dynamicPrice });

    return res.status(201).json({
      message: "Listing Live on Thore Network.",
      listing: {
        id: listing._id,
        availableKw: Number(listing.availableKw.toFixed(2)),
        pricePerKw: listing.pricePerKw,
      },
      dynamicPrice,
    });
  } catch (error) {
    return res.status(500).json({ message: "Broadcast failed" });
  }
});

router.get("/listings", authRequired, async (_req, res) => {
  try {
    const listings = await Listing.find({ status: { $in: ["live", "partial"] } })
      .populate("seller", "houseId name")
      .sort({ createdAt: -1 })
      .lean();

    const payload = listings.map((item) => ({
      id: item._id,
      sellerId: item.seller._id,
      sellerHouse: `House #${item.seller.houseId}`,
      sellerName: item.seller.name,
      availableKw: Number(item.availableKw.toFixed(2)),
      pricePerKw: item.pricePerKw,
      co2IfBought: Number((item.availableKw * CO2_PER_KWH).toFixed(2)),
    }));

    return res.json({ listings: payload });
  } catch (error) {
    return res.status(500).json({ message: "Unable to fetch listings" });
  }
});

router.delete("/listings/:id", authRequired, async (req, res) => {
  try {
    if (req.user.role !== "prosumer") {
      return res.status(403).json({ message: "Only prosumers can remove listings" });
    }

    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: "Listing not found" });
    }

    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Cannot remove another seller listing" });
    }

    if (listing.status === "sold") {
      return res.status(400).json({ message: "Sold listing cannot be deleted" });
    }

    await listing.deleteOne();
    return res.json({ message: "Listing removed" });
  } catch (error) {
    return res.status(500).json({ message: "Unable to delete listing" });
  }
});

router.post("/trade", authRequired, async (req, res) => {
  if (req.user.role !== "consumer") {
    return res.status(403).json({ message: "Only consumers can buy energy" });
  }

  try {
    const { listingId, requestedKw, paymentToken } = req.body;
    const idempotencyKey = String(req.headers["x-idempotency-key"] || "").trim();
    const kwRaw = Number(requestedKw);

    if (!listingId || !mongoose.Types.ObjectId.isValid(listingId)) {
      return res.status(400).json({ message: "Valid listingId is required" });
    }

    if (!Number.isFinite(kwRaw) || kwRaw <= 0) {
      return res.status(400).json({ message: "requestedKw must be a positive number" });
    }

    const kw = normalizeKw(kwRaw);
    if (kw < 0.01) {
      return res.status(400).json({ message: "requestedKw is below the minimum tradable amount" });
    }

    if (!/^[a-zA-Z0-9._:-]{12,128}$/.test(idempotencyKey)) {
      return res.status(400).json({ message: "Valid x-idempotency-key header is required" });
    }

    const existingTx = await Transaction.findOne({ idempotencyKey }).lean();
    if (existingTx) {
      return res.json({
        message: "Settlement already processed",
        transactionId: existingTx._id,
        deductedTet: Number(existingTx.amountTet.toFixed(2)),
        energyKw: Number(existingTx.energyKw.toFixed(2)),
        co2SavedKg: existingTx.co2SavedKg,
        paymentId: existingTx.paymentId,
        idempotentReplay: true,
      });
    }

    const listing = await Listing.findById(listingId);
    if (!listing || listing.status === "sold") {
      return res.status(409).json({ message: "Listing unavailable" });
    }

    const [seller, buyer] = await Promise.all([
      User.findById(listing.seller),
      User.findById(req.user._id),
    ]);

    if (!seller || !buyer) {
      return res.status(409).json({ message: "Account missing" });
    }

    const paymentTokenStr = String(paymentToken || "").trim();
    if (!/^\d{6}$/.test(paymentTokenStr)) {
      return res.status(400).json({ message: "Valid 6-digit payment token is required" });
    }

    if (buyer.paymentToken !== paymentTokenStr) {
      return res.status(401).json({ message: "Payment token verification failed" });
    }

    if (seller._id.toString() === buyer._id.toString()) {
      return res.status(400).json({ message: "Cannot buy your own listing" });
    }

    const energyKw = normalizeKw(kw);
    const availableKw = normalizeKw(listing.availableKw);

    if (energyKw > availableKw) {
      return res.status(409).json({ message: "Requested energy exceeds current listing availability" });
    }

    if (energyKw <= 0 || availableKw <= 0) {
      return res.status(409).json({ message: "No energy available" });
    }

    const amountTet = Number((energyKw * listing.pricePerKw).toFixed(2));
    if (buyer.walletBalance < amountTet) {
      return res.status(400).json({ message: "Insufficient wallet balance" });
    }

    const co2SavedKg = Number((energyKw * CO2_PER_KWH).toFixed(3));

    buyer.walletBalance = Number((buyer.walletBalance - amountTet).toFixed(2));
    seller.walletBalance = Number((seller.walletBalance + amountTet).toFixed(2));
    listing.availableKw = Number((listing.availableKw - energyKw).toFixed(2));
    listing.status = listing.availableKw <= 0 ? "sold" : "partial";

    const paymentId = `PAY-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;
    const latestTx = await Transaction.findOne().sort({ createdAt: -1 }).lean();
    const prevHash = latestTx?.currentHash || GENESIS_HASH;
    const createdAt = new Date().toISOString();

    const currentHash = buildLedgerHash({
      buyerId: buyer._id.toString(),
      sellerId: seller._id.toString(),
      listingId: listing._id.toString(),
      energyKw,
      pricePerKw: listing.pricePerKw,
      amountTet,
      paymentId,
      idempotencyKey,
      prevHash,
      createdAt,
    });

    const [tx] = await Promise.all([
      Transaction.create({
        buyer: buyer._id,
        seller: seller._id,
        listing: listing._id,
        energyKw,
        pricePerKw: listing.pricePerKw,
        amountTet,
        co2SavedKg,
        paymentId,
        idempotencyKey,
        prevHash,
        currentHash,
      }),
      buyer.save(),
      seller.save(),
      listing.save(),
    ]);

    // Emit real-time event
    const io = req.app.get("io");
    if (io) {
      io.emit("trade:settled", {
        paymentId: tx.paymentId,
        energyKw,
        co2SavedKg,
        amountTet,
        buyerHouseId: buyer.houseId,
        sellerHouseId: seller.houseId,
      });
    }

    return res.json({
      message: "Settlement complete",
      transactionId: tx._id,
      deductedTet: amountTet,
      energyKw,
      co2SavedKg,
      paymentId: tx.paymentId,
      currentHash: tx.currentHash,
      newBuyerBalance: Number(buyer.walletBalance.toFixed(2)),
      newSellerBalance: Number(seller.walletBalance.toFixed(2)),
    });
  } catch (error) {
    console.error("Trade failed", error);
    return res.status(500).json({ message: "Trade failed" });
  }
});

export default router;
