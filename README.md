# CJdropshipping Winning Product Hunter — Local POC

This is a small, local-first starter project. It provides:
- A local web dashboard
- A Chrome Extension popup
- A backend proxy so the CJ token is not exposed to the browser
- Basic profit estimation and an explicitly preliminary score

## Important limitations
1. CJ API endpoint, parameters, token type, and authentication header can vary by API version/account. Verify these against your own official CJ API documentation before testing. The adapter currently uses `CJ-Access-Token` and `/product/listV2` as configurable starting assumptions, not a guarantee.
2. This POC does not prove demand, sales volume, or competition. Trend providers are not connected yet. Score fields that lack evidence are labelled as unknown/neutral rather than being represented as verified market facts.
3. Keep the token in `.env` only. Do not share it or commit `.env` to Git.
4. Only use API access and data collection methods permitted by CJ and each external provider.

## Requirements
- Node.js 20+ (Node 22 recommended)
- Chrome or Chromium for the extension

## Run locally
1. Extract this folder.
2. Open a terminal in this folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
   - Windows PowerShell: `Copy-Item .env.example .env`
   - macOS/Linux: `cp .env.example .env`
5. Put your CJ token in `.env` locally.
6. Verify `CJ_API_BASE_URL`, `CJ_PRODUCT_LIST_PATH`, and authentication header with your official CJ API docs.
7. Run `npm start`.
8. Open http://localhost:3000

If CJ returns an authentication or parameter error, the dashboard will show a readable message. Check the terminal and CJ API docs; do not paste your token into a chat.

## Load the Chrome Extension
1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked**.
4. Select the `extension` folder.
5. Start the local backend (`npm start`) before using the extension.

## Current API contract
The server tries:
`GET {CJ_API_BASE_URL}{CJ_PRODUCT_LIST_PATH}?pageNum=1&pageSize=20&productName={query}`

The exact query parameters and response envelope must be checked against your CJ API version. If the API uses different parameters, update `server/cjClient.js`. Do not disable TLS verification.

## POC score
The score is a rough workflow demonstration, not a validated prediction:
- Profit potential: up to 25 points, based on estimated margin when a product price is available
- Data completeness: up to 25 points
- Shipping evidence: up to 15 points (unknown stays neutral/low)
- Stock evidence: up to 15 points
- Trend and competition: not connected yet, so no invented signal is added

The model should be calibrated with real data before using it for decisions.

## Next milestones
1. Confirm CJ API auth, product search, detail, inventory, and shipping endpoints.
2. Normalize API response shapes and add pagination/rate-limit handling.
3. Add saved products and local persistence.
4. Add trend-provider adapters after confirming access and permitted usage.
5. Add country-specific landed cost and currency conversion.
6. Add authentication before exposing the dashboard outside localhost.
