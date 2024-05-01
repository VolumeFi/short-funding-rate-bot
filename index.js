import express from 'express';
import { processDeposits } from "./short-funding.js";
import * as Sentry from "@sentry/node";
import crvusd from "@curvefi/stablecoin-api";



import dotenv from 'dotenv';
dotenv.config();

Sentry.init({
  dsn: 'https://f9372d02dc7eba81a2b948e5fb2572f8@o1200162.ingest.sentry.io/4506061378682880',
  // Performance Monitoring
  tracesSampleRate: 1.0,
});

processDeposits();

const app = express();

app.get('/', (req, res) => {
    res.send('Service is running!');
});


const port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`Check status on port ${port}`);
});

