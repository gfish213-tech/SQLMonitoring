import path from "path";
import fs from "fs";
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

// Resolves to <repo>/client/dist whether running via tsx from server/src or the compiled
// server/dist — both are two directories below the repo root.
const clientDist = path.resolve(__dirname, "../../client/dist");

if (fs.existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  console.warn(
    `client/dist not found (looked in ${clientDist}). Run "npm run build" in client/ first, ` +
      "or use the client's own dev server (npm run dev) while developing the UI."
  );
}

app.listen(PORT, () => {
  console.log(`SQL performance monitor listening on port ${PORT}`);
});
