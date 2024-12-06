import puppeteer from "puppeteer";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use("/captures", express.static(path.join(__dirname, "captures")));

// Configuration constants
const CONFIG = {
  VIEWPORT: {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 2,
  },
  CAMERA: {
    fov: 60,
    near: 0.01,
    far: 100,
    position: [0, 0, 0],
    target: [0, 0, 0],
  },
  PAGE_LOAD_TIMEOUT: 120000, // 2 minutes
};

async function captureFrontView(browser, url, viewportSettings) {
  const page = await browser.newPage();
  await page.setViewport(CONFIG.VIEWPORT);

  await page.goto(`${url}/front`, {
    waitUntil: ["networkidle0", "load"],
    timeout: CONFIG.PAGE_LOAD_TIMEOUT,
  });

  await page.evaluate((settings) => {
    window.captureSettings = settings;
  }, viewportSettings);

  console.log("Capturing front view...");
  const frontImage = await page.evaluate(async () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return null;

    return canvas.toDataURL("image/png");
  });

  await page.close();
  return frontImage;
}

async function captureBackView(browser, url, viewportSettings) {
  const page = await browser.newPage();
  await page.setViewport(CONFIG.VIEWPORT);

  await page.goto(`${url}/back`, {
    waitUntil: ["networkidle0", "load"],
    timeout: CONFIG.PAGE_LOAD_TIMEOUT,
  });

  await page.evaluate((settings) => {
    window.captureSettings = settings;
  }, viewportSettings);

  console.log("Capturing back view...");
  const backImage = await page.evaluate(async () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return null;

    return canvas.toDataURL("image/png");
  });

  await page.close();
  return backImage;
}

async function captureModel(url, viewportSettings) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  try {
    // Capture both views in parallel
    const [frontImage, backImage] = await Promise.all([
      captureFrontView(browser, url, viewportSettings),
      captureBackView(browser, url, viewportSettings),
    ]);

    return { frontImage, backImage };
  } finally {
    await browser.close();
  }
}

// API endpoint to handle capture requests
app.post("/api/capture", async (req, res) => {
  console.log("Capture request:", req.body);

  try {
    const { customizationId } = req.body;

    // URL to your client app with the specific customization
    const baseUrl = process.env.CLIENT_URL || "http://localhost:5173";
    const captureUrl = `${baseUrl}/capture/${customizationId}`;

    const images = await captureModel(captureUrl, CONFIG.CAMERA);

    // Ensure the captures directory exists
    const capturesDir = path.join(__dirname, "captures");
    await mkdir(capturesDir, { recursive: true });

    const serverUrl = process.env.SERVER_URL || "http://localhost:3001";

    // Save images to firebase cloud storage
    const frontPath = path.join(
      __dirname,
      "captures",
      `${customizationId}_front.png`
    );
    const backPath = path.join(
      __dirname,
      "captures",
      `${customizationId}_back.png`
    );

    await Promise.all([
      writeFile(frontPath, images.frontImage.split(";base64,").pop(), "base64"),
      writeFile(backPath, images.backImage.split(";base64,").pop(), "base64"),
    ]);

    console.log("Images saved:", {
      front: frontPath,
      back: backPath,
    });

    res.json({
      success: true,
      images: {
        front: `${serverUrl}/captures/${customizationId}_front.png`,
        back: `${serverUrl}/captures/${customizationId}_back.png`,
      },
    });

    // delete images after from local storage
    // await unlink(frontPath);
    // await unlink(backPath);
  } catch (error) {
    console.error("Capture failed:", error);
    res.status(500).json({ success: false, error: "Capture failed" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Capture service running on port ${PORT}`));
