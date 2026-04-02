import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import mongoose from "mongoose";
import authRoutes from "./routes/auth.js";
import marketRoutes from "./routes/market.js";
import ledgerRoutes from "./routes/ledger.js";

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN,
  })
);
app.use(express.json());
app.use(morgan("dev"));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "Vidyut Setu API" });
});

app.use("/api/auth", authRoutes);
app.use("/api", marketRoutes);
app.use("/api/ledger", ledgerRoutes);

const start = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const port = process.env.PORT || 5000;
    app.listen(port, () => {
      console.log(`Vidyut Setu backend listening on ${port}`);
    });
  } catch (error) {
    console.error("Mongo connection failed", error);
    process.exit(1);
  }
};

start();
