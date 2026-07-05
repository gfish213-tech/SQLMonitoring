import express from "express";
import cors from "cors";
import connectionRouter from "./routes/connection";
import dashboardRouter from "./routes/dashboard";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/connection", connectionRouter);
app.use("/api", dashboardRouter);

app.listen(PORT, () => {
  console.log(`SQL performance monitor API listening on port ${PORT}`);
});
