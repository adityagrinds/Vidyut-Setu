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

  // 5 prosumers + 3 consumers for a lively marketplace
  const users = await User.create([
    {
      houseId: 42,
      name: "Arjun Solar (House 42)",
      email: "prosumer@sauryasetu.local",
      passwordHash,
      role: "prosumer",
      walletBalance: 120.0,
    },
    {
      houseId: 17,
      name: "Meera Energy (House 17)",
      email: "prosumer2@sauryasetu.local",
      passwordHash,
      role: "prosumer",
      walletBalance: 85.0,
    },
    {
      houseId: 55,
      name: "Ravi Green (House 55)",
      email: "prosumer3@sauryasetu.local",
      passwordHash,
      role: "prosumer",
      walletBalance: 200.0,
    },
    {
      houseId: 8,
      name: "Priya Solar (House 8)",
      email: "prosumer4@sauryasetu.local",
      passwordHash,
      role: "prosumer",
      walletBalance: 60.0,
    },
    {
      houseId: 33,
      name: "Kiran Sun (House 33)",
      email: "prosumer5@sauryasetu.local",
      passwordHash,
      role: "prosumer",
      walletBalance: 150.0,
    },
    {
      houseId: 19,
      name: "Consumer House 19",
      email: "consumer@sauryasetu.local",
      passwordHash,
      role: "consumer",
      walletBalance: 500.0,
      paymentToken: "654321",
    },
    {
      houseId: 27,
      name: "Consumer House 27",
      email: "consumer2@sauryasetu.local",
      passwordHash,
      role: "consumer",
      walletBalance: 350.0,
      paymentToken: "112233",
    },
    {
      houseId: 61,
      name: "Consumer House 61",
      email: "consumer3@sauryasetu.local",
      passwordHash,
      role: "consumer",
      walletBalance: 280.0,
      paymentToken: "998877",
    },
  ]);

  const [p1, p2, p3, p4, p5] = users;

  // Create varied listings from all 5 prosumers
  await Listing.create([
    { seller: p1._id, availableKw: 2.16, pricePerKw: 9, status: "live" },
    { seller: p2._id, availableKw: 3.50, pricePerKw: 8, status: "live" },
    { seller: p3._id, availableKw: 1.80, pricePerKw: 10, status: "live" },
    { seller: p4._id, availableKw: 4.20, pricePerKw: 7, status: "live" },
    { seller: p5._id, availableKw: 2.75, pricePerKw: 9, status: "live" },
  ]);

  console.log("✅ Seed complete — 5 prosumers + 3 consumers");
  console.log("Demo accounts:");
  console.log("  prosumer@sauryasetu.local / 123456");
  console.log("  consumer@sauryasetu.local / 123456  (token: 654321)");
  console.log("  consumer2@sauryasetu.local / 123456 (token: 112233)");
  console.log("  consumer3@sauryasetu.local / 123456 (token: 998877)");

  await mongoose.disconnect();
};

seed().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
