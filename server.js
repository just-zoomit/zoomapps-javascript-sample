import express from 'express';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// OAuth imports
import session from 'express-session';
import crypto from 'crypto';

import {
  exchangeCodeForAccessToken,
  createZoomDeeplink,
} from "./lib/zoom-api.js";

// Load environment variables from a .env file
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const execAsync = promisify(exec);

// Middleware to parse JSON bodies in incoming requests
app.use(express.json());

// session (put near top, before routes)
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // set true when behind HTTPS + proxy
}));

app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://source.zoom.us", "https://appssdk.zoom.us/sdk.js"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", "wss:", "https://zoom.us", "*.zoom.us"],
          imgSrc: ["'self'", "data:"],
          frameSrc: ["'self'", "*.zoom.us"],
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
    })
  );


// Default route: redirect based on user agent
app.get('/', (req, res) => {
    const userAgent = req.get('User-Agent') || '';
  
    if (userAgent.includes('ZoomApps')) {
      // Serve index.html for Zoom client
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
      // Serve browser fallback page
      res.sendFile(path.join(__dirname, 'public', 'browser.html'));
    }
  });

  app.use(express.static(path.join(__dirname, "public")));

// ---- OAuth start: redirect user to Zoom ----
app.get('/auth/start', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const authorize = new URL('https://zoom.us/oauth/authorize');
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.ZOOM_CLIENT_ID,
    redirect_uri: process.env.ZOOM_REDIRECT_URI,
    state
  }).toString();

  console.log("Redirecting to Zoom OAuth:", authorize.toString());

  res.redirect(authorize.toString());
});

// ---- OAuth callback: exchange code -> token, then create deeplink ----
app.get('/auth/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query;
  

    // 1)  Exchange code for token
    const token = await exchangeCodeForAccessToken({
      code,
      redirectUri: process.env.ZOOM_REDIRECT_URI,
      clientId: process.env.ZOOM_CLIENT_ID,
      clientSecret: process.env.ZOOM_CLIENT_SECRET,
    });

    // 2) Create deeplink (customize payload as needed)

    const deeplink = await createZoomDeeplink({
      accessToken: token.access_token,
      payload: {
        action: "openApp", // free-form
        type: 1,           // 1 = open in Zoom Client
        // You can add fields like "target", etc., if your endpoint supports them.
      },
    });

    // 3) Redirect the browser to Zoom deeplink (opens the client)
    return res.redirect(deeplink);
  } catch (e) {
    next(e);
  }
});


// Serve the frontend page for Zoom iframe
app.get('/home', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

import http from 'http';
const server = http.createServer(app);

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
   
});