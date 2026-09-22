import { createApp } from "./app.js";

const port = Number(process.env.PORT || 3001);
createApp({ dataDir: process.env.DATA_DIR }).listen(port, "0.0.0.0", () => {
  console.log(`Premi Comerç de Barcelona: http://localhost:${port}`);
});
