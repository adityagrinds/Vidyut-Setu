import express from "express";
import { authRequired } from "../middleware/auth.js";
import { Listing } from "../models/Listing.js";
import { Transaction } from "../models/Transaction.js";
import { User } from "../models/User.js";
import { buildLedgerHash, GENESIS_HASH } from "../utils/ledgerHash.js";

const router = express.Router();

const DYNAMIC_PRICE = 9;

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

    const listing = await Listing.create({
      seller: req.user._id,
      availableKw: Number(safeSurplus.toFixed(2)),
      pricePerKw: DYNAMIC_PRICE,
    });

    return res.status(201).json({
      message: "Listing Live on Thore Network.",
      listing: {
        id: listing._id,
        availableKw: Number(listing.availableKw.toFixed(2)),
        pricePerKw: listing.pricePerKw,
      },
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
    const kw = Number(requestedKw || 0);

    if (!listingId || kw <= 0) {
      return res.status(400).json({ message: "listingId and requestedKw are required" });
    }

    if (!idempotencyKey || idempotencyKey.length < 12) {
      return res.status(400).json({ message: "Valid x-idempotency-key header is required" });
    }

    const existingTx = await Transaction.findOne({ idempotencyKey }).lean();
    if (existingTx) {
      return res.json({
        message: "Settlement already processed",
        transactionId: existingTx._id,
        deductedTet: Number(existingTx.amountTet.toFixed(2)),
        energyKw: Number(existingTx.energyKw.toFixed(2)),
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

    if (!paymentToken || !/^\d{6}$/.test(paymentToken)) {
      return res.status(400).json({ message: "Valid 6-digit payment token is required" });
    }

    if (buyer.paymentToken !== paymentToken) {
      return res.status(401).json({ message: "Payment token verification failed" });
    }

    if (seller._id.toString() === buyer._id.toString()) {
      return res.status(400).json({ message: "Cannot buy your own listing" });
    }

    const energyKw = Number(Math.min(kw, listing.availableKw).toFixed(2));
    if (energyKw <= 0) {
      return res.status(409).json({ message: "No energy available" });
    }

    const amountTet = Number((energyKw * listing.pricePerKw).toFixed(2));
    if (buyer.walletBalance < amountTet) {
      return res.status(400).json({ message: "Insufficient wallet balance" });
    }

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
        paymentId,
        idempotencyKey,
        prevHash,
        currentHash,
        createdAt,
      }),
      buyer.save(),
      seller.save(),
      listing.save(),
    ]);

    return res.json({
      message: "Settlement complete",
      transactionId: tx._id,
      deductedTet: amountTet,
      energyKw,
      paymentId: tx.paymentId,
      currentHash: tx.currentHash,
      newBuyerBalance: Number(buyer.walletBalance.toFixed(2)),
      newSellerBalance: Number(seller.walletBalance.toFixed(2)),
    });
  } catch (error) {
    return res.status(409).json({ message: error.message || "Trade failed" });
  }
});

export default router;
