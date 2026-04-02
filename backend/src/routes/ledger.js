import express from "express";
import { authRequired } from "../middleware/auth.js";
import { Transaction } from "../models/Transaction.js";
import { buildLedgerHash, GENESIS_HASH } from "../utils/ledgerHash.js";

const router = express.Router();

const relativeTime = (date) => {
  const diffSeconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diffSeconds < 60) return `${diffSeconds} secs ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} mins ago`;
  return `${Math.floor(diffSeconds / 3600)} hrs ago`;
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
      fromTo: `House #${txn.seller.houseId} -> House #${txn.buyer.houseId}`,
      amountTet: Number(txn.amountTet.toFixed(2)),
      energyKw: Number(txn.energyKw.toFixed(2)),
      chainHash: txn.currentHash,
      prevHash: txn.prevHash,
      integrity: expectedHash === txn.currentHash ? "Verified" : "Tampered",
      status: "Settled",
    }});

    return res.json({ rows });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load ledger" });
  }
});

export default router;
