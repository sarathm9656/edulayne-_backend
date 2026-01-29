import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import connectDB from "./config/database.js";
import cookieParser from "cookie-parser";
import indexRoutes from "./routes/index.routes.js";
import morgan from "morgan";
import dyteRoutes from "./routes/dyte.routes.js"
// ES Module fix for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


// Create Express app
const app = express();
app.set("trust proxy", 1);

// Middleware
const allowedOrigins = [
  "https://edulayne-online.netlify.app",
  "http://localhost:5173",
];

app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (Postman, mobile apps)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use("/api/dyte", dyteRoutes);
// Connect to Database
connectDB();

// Uploads folder as static (General uploads)
app.use("/api/uploads", express.static(join(__dirname, "uploads")));

// Recordings folder as static (Configurable System Storage)
// Use the path from .env or default to local uploads/recordings
const recordingsPath = process.env.RECORDINGS_PATH || "uploads/recordings";
import fs from 'fs';
if (!fs.existsSync(recordingsPath)) {
  // Try to create it if it's a relative path, otherwise warn
  try {
    fs.mkdirSync(recordingsPath, { recursive: true });
  } catch (e) {
    console.warn("Could not create recordings directory:", recordingsPath);
  }
}
app.use("/api/static-recordings", express.static(recordingsPath));

// Routes
app.use("/api", indexRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

// get the course images static to the frontend

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});