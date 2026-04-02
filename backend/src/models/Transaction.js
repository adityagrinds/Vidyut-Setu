import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: "Listing", required: true },
    energyKw: { type: Number, required: true },
    pricePerKw: { type: Number, required: true },
    amountTet: { type: Number, required: true },
    paymentId: { type: String, required: true },
    idempotencyKey: { type: String, required: true, unique: true },
    prevHash: { type: String, required: true },
    currentHash: { type: String, required: true },
    status: { type: String, enum: ["settled"], default: "settled" },
  },
  { timestamps: true }
);

export const Transaction = mongoose.model("Transaction", transactionSchema);
