import mongoose from "mongoose";

const listingSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    availableKw: { type: Number, required: true },
    pricePerKw: { type: Number, required: true },
    status: {
      type: String,
      enum: ["live", "partial", "sold"],
      default: "live",
    },
  },
  { timestamps: true }
);

export const Listing = mongoose.model("Listing", listingSchema);
