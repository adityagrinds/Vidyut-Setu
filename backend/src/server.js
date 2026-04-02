import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import mongoose from "mongoose";
import http from "http";
import compression from "compression";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { Server as SocketIOServer } from "socket.io";
import authRoutes from "./routes/auth.js";
import marketRoutes from "./routes/market.js";
import ledgerRoutes from "./routes/ledger.js";

const requiredEnvKeys = ["MONGO_URI", "JWT_SECRET", "CLIENT_ORIGIN"];
for (const key of requiredEnvKeys) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

if (process.env.JWT_SECRET === "replace_with_super_secret_key") {
  console.warn("JWT_SECRET is using the template value. Change it before production use.");
}

const app = express();
const httpServer = http.createServer(app);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const io = new SocketIOServer(httpServer, {
  cors: { origin: process.env.CLIENT_ORIGIN, methods: ["GET", "POST"] },
});

app.set("io", io);

app.disable("x-powered-by");
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(cors({ origin: process.env.CLIENT_ORIGIN }));
app.use(compression());
app.use(express.json());
app.use(morgan("dev"));
app.use("/api", apiLimiter);

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "Vidyut Setu API",
    timestamp: new Date().toISOString(),
    uptimeSec: Number(process.uptime().toFixed(0)),
    mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api", marketRoutes);
app.use("/api/ledger", ledgerRoutes);

app.use((_req, res) => {
  return res.status(404).json({ message: "Route not found" });
});

app.use((error, _req, res, _next) => {
  console.error("Unhandled API error", error);
  return res.status(500).json({ message: "Internal server error" });
});

io.on("connection", (socket) => {
  console.log(`WS client connected: ${socket.id}`);
  socket.on("disconnect", () => console.log(`WS client gone: ${socket.id}`));
});

const start = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const port = process.env.PORT || 5055;
    httpServer.listen(port, () => {
      console.log(`Vidyut Setu backend listening on ${port}`);
    });
  } catch (error) {
    console.error("Mongo connection failed", error);
    process.exit(1);
  }
};

start();
