import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "./models/User.js";
import { Listing } from "./models/Listing.js";
import { Transaction } from "./models/Transaction.js";

const seed = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  await Promise.all([
    User.deleteMany({}),
    Listing.deleteMany({}),
    Transaction.deleteMany({}),
  ]);

  const passwordHash = await bcrypt.hash("123456", 10);

  const [prosumer, consumer] = await User.create([
    {
      houseId: 42,
      name: "Prosumer House",
      email: "prosumer@sauryasetu.local",
      passwordHash,
      role: "prosumer",
      walletBalance: 100.0,
    },
    {
      houseId: 19,
      name: "Consumer House",
      email: "consumer@sauryasetu.local",
      passwordHash,
      role: "consumer",
      walletBalance: 500.0,
      paymentToken: "654321",
    },
  ]);

  await Listing.create({
    seller: prosumer._id,
    availableKw: 2.16,
    pricePerKw: 9,
    status: "live",
  });

  console.log("Seed complete");
  console.log("prosumer@sauryasetu.local / 123456");
  console.log("consumer@sauryasetu.local / 123456");
  console.log("consumer payment token: 654321");

  await mongoose.disconnect();
};

seed().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
