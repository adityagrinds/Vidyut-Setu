import crypto from "crypto";

export const GENESIS_HASH = "GENESIS";

export const buildLedgerHash = ({
  buyerId,
  sellerId,
  listingId,
  energyKw,
  pricePerKw,
  amountTet,
  paymentId,
  idempotencyKey,
  prevHash,
  createdAt,
}) => {
  const payload = [
    buyerId,
    sellerId,
    listingId,
    energyKw,
    pricePerKw,
    amountTet,
    paymentId,
    idempotencyKey,
    prevHash,
    createdAt,
  ].join("|");

  return crypto.createHash("sha256").update(payload).digest("hex");
};
