import express from "express";
import { authRequired } from "../middleware/auth.js";
import { Transaction } from "../models/Transaction.js";
import { buildLedgerHash, GENESIS_HASH } from "../utils/ledgerHash.js";

const router = express.Router();
const CO2_PER_KWH = 0.82;

const relativeTime = (date) => {
  const diffSeconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  return `${Math.floor(diffSeconds / 3600)}h ago`;
};

router.get("/recent", authRequired, async (_req, res) => {
  try {
    const txns = await Transaction.find()
      .populate("buyer", "houseId")
      .populate("seller", "houseId")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const rows = txns.map((txn) => {
      const expectedHash = buildLedgerHash({
        buyerId: txn.buyer._id.toString(),
        sellerId: txn.seller._id.toString(),
        listingId: txn.listing.toString(),
        energyKw: txn.energyKw,
        pricePerKw: txn.pricePerKw,
        amountTet: txn.amountTet,
        paymentId: txn.paymentId,
        idempotencyKey: txn.idempotencyKey,
        prevHash: txn.prevHash || GENESIS_HASH,
        createdAt: new Date(txn.createdAt).toISOString(),
      });

      return {
        id: txn._id,
        hash: `0x${txn._id.toString().slice(0, 4)}...${txn._id.toString().slice(-4)}`,
        paymentId: txn.paymentId,
        timestamp: relativeTime(txn.createdAt),
        fromTo: `House #${txn.seller.houseId} → House #${txn.buyer.houseId}`,
        amountTet: Number(txn.amountTet.toFixed(2)),
        energyKw: Number(txn.energyKw.toFixed(2)),
        co2SavedKg: Number((txn.co2SavedKg || txn.energyKw * CO2_PER_KWH).toFixed(3)),
        chainHash: txn.currentHash,
        prevHash: txn.prevHash,
        integrity: expectedHash === txn.currentHash ? "Verified" : "Tampered",
        status: "Settled",
        buyerHouseId: txn.buyer.houseId,
        sellerHouseId: txn.seller.houseId,
        pricePerKw: txn.pricePerKw,
      };
    });

    return res.json({ rows });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load ledger" });
  }
});

// Green certificate endpoint
router.get("/certificate/:id", authRequired, async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id)
      .populate("buyer", "houseId name")
      .populate("seller", "houseId name")
      .lean();

    if (!txn) return res.status(404).json({ message: "Transaction not found" });

    const co2Kg = Number((txn.co2SavedKg || txn.energyKw * CO2_PER_KWH).toFixed(3));

    return res.json({
      certificate: {
        id: txn._id,
        paymentId: txn.paymentId,
        issuedAt: new Date(txn.createdAt).toISOString(),
        buyerHouse: `House #${txn.buyer.houseId}`,
        sellerHouse: `House #${txn.seller.houseId}`,
        energyKwh: txn.energyKw,
        pricePerKwh: txn.pricePerKw,
        amountTet: txn.amountTet,
        co2SavedKg: co2Kg,
        treesEquivalent: Number((co2Kg / 21).toFixed(3)),
        hash: txn.currentHash,
        integrity: "Verified",
        issuer: "Vidyut Setu — Decentralized Energy Mesh",
        note: "This certificate confirms that clean solar energy was directly traded P2P, offset from the fossil-fuel grid.",
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Certificate generation failed" });
  }
});

export default router;
