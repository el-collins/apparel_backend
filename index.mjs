import puppeteer from "puppeteer";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { initializeApp, cert } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

dotenv.config();

// Load the service account key JSON content from environment variable
const serviceAccountJson = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!serviceAccountJson) {
  throw new Error('The GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable is not set.');
}

// Parse the JSON content
const serviceAccount = JSON.parse(serviceAccountJson);


// Initialize Firebase with service account
initializeApp({
  credential: cert(serviceAccount),
  storageBucket: "ue-apparel-stage.firebasestorage.app", // Updated bucket name
});

const storage = getStorage();
const bucket = storage.bucket();

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
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
    waitUntil: ["networkidle0"],
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
    waitUntil: ["networkidle0"],
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
  const browser = await puppeteer.launch();

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

async function uploadToFirebaseStorage(imageData, filename) {
  const file = bucket.file(`captures/${filename}`);
  const base64Data = imageData.split(";base64,").pop() || "";

  await file.save(Buffer.from(base64Data, "base64"), {
    contentType: "image/png",
  });

  console.log(`Uploaded file: captures/${filename}`);

  return `https://storage.googleapis.com/${bucket.name}/${file.name}`;

  // // Get a signed URL that doesn't expire
  // const [url] = await file.getSignedUrl({
  //   action: 'read',
  //   expires: '03-01-2500', // Set a very far future date
  // });

  // // Convert to a permanent public URL
  // const publicUrl = url.split('?')[0] + '?alt=media';

  // console.log(`Uploaded file: captures/${filename}`);
  // return publicUrl;

  // return `https://storage.googleapis.com/${bucket.name}/captures/${filename}`;

  // Alternatively, you could also use Firebase's getDownloadURL() method, which would be even simpler:
  // const [downloadUrl] = await file.getDownloadURL();
  // return downloadUrl;
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

    // Upload images to Firebase Storage
    const [frontUrl, backUrl] = await Promise.all([
      uploadToFirebaseStorage(
        images.frontImage || "",
        `${customizationId}_front.png`
      ),
      uploadToFirebaseStorage(
        images.backImage || "",
        `${customizationId}_back.png`
      ),
    ]);

    console.log("Images saved:", {
      front: frontUrl,
      back: backUrl,
    });

    res.json({
      success: true,
      images: {
        front: frontUrl,
        back: backUrl,
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

app.get('/', (req, res) => {
  res.send('Hello server');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Capture service running on port ${PORT}`));
