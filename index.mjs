import puppeteer from "puppeteer";
import express from "express";
import cors from "cors";
import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.json({ limit: "50mb" }));

app.use("/captures", express.static(path.join(__dirname, "captures")));

// test endpoint
app.get("/", (req, res) => {
  res.send("Capture service is running");
});

async function captureModel(url, viewportSettings) {
  const browser = await puppeteer.launch({
    headless: false,
    //   args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();

        // Increase timeouts
        await page.setDefaultNavigationTimeout(120000); // 2 minutes
        await page.setDefaultTimeout(120000);

    // Set viewport size
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 2,
    });

    // Set longer timeout for initial page load
    // page.setDefaultNavigationTimeout(60000);
    page.on('console', msg => console.log('Browser console:', msg.text()));
    page.on('pageerror', err => console.error('Page error:', err));
    page.on('error', err => console.error('Error:', err));

    // Navigate to the page
    await page.goto(url, {
      waitUntil: ["networkidle0"],
      timeout: 120000,
      // signal: 
    });

    // Inject the capture settings
    await page.evaluate((settings) => {
      window.captureSettings = settings;
    }, viewportSettings);

    // Wait for initial scene setup
    // await page.waitForTimeout(3000);

    // Capture front view
    const frontImage = await page.evaluate(async () => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return null;

      // Position camera for front view
      const camera = window.threeCamera;
      if (camera) {
        camera.position.set(0, 0, 0.035);
        camera.rotation.set(0, 0, 0);
        camera.updateProjectionMatrix();
      }

      // Allow time for render
      await new Promise((resolve) => setTimeout(resolve, 1000));

      return canvas.toDataURL("image/png");
    });


    // Capture back view
    const backImage = await page.evaluate(async () => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return null;

      // Position camera for back view
      const camera = window.threeCamera;
      if (camera) {
        camera.position.set(0, 0, -0.035);
        camera.rotation.set(0, Math.PI, 0);


        camera.updateProjectionMatrix();
      }

      // Allow time for render
      await new Promise((resolve) => setTimeout(resolve, 1000));

      return canvas.toDataURL("image/png");
    });

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
    const settings = {
      fov: 60,
      near: 0.01,
      far: 100,
      position: [0, 0, 0],
      target: [0, 0, 0],
    };

    // URL to your client app with the specific customization
    const captureUrl = `http://localhost:5173/capture/${customizationId}`;

    const images = await captureModel(captureUrl, settings);

    // Ensure the captures directory exists
    const capturesDir = path.join(__dirname, "captures");
    await mkdir(capturesDir, { recursive: true });

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
        front: `http://localhost:3001/captures/${customizationId}_front.png`,
        back: `http://localhost:3001/captures/${customizationId}_back.png`,
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
