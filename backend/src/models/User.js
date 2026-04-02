import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    houseId: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["prosumer", "consumer"], required: true },
    paymentToken: {
      type: String,
      validate: {
        validator: (value) => !value || /^\d{6}$/.test(value),
        message: "paymentToken must be a 6-digit string",
      },
    },
    walletBalance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);
