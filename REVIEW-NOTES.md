# Configuration and review notes

Use Node 24 (minimum 22.12). Run `npm ci` in each project. Configure the backend using `.env.example`; configure the frontend `VITE_API_URL` with the deployed backend URL ending in `/api`, then rebuild it. Set backend `FRONTEND_URL` to the exact frontend origin, or a comma-separated list. The local environment had service credentials but no frontend origin configured.

## MilesWeb startup and deployment

Use the backend directory containing `package.json` as the application root and `server.js` as the startup file. LiteSpeed loading `api/index.js` directly is also supported: the app starts its database connection explicitly and prevents the hosting loader from opening a listener before that connection completes. Environment files are loaded from the backend root regardless of the working directory; hosting environment variables retain precedence.

After pushing to GitHub, update the checkout in the actual MilesWeb application root (cPanel Git Version Control: Update from Remote), install dependencies in the app's Node.js environment, then restart that app. Restarting alone does not fetch GitHub changes. If the Git checkout and application root differ, deploy the updated files into the application root before restarting.

Successful startup logs `Database Connected Successfully` followed by `Server listening...`. `/health` now includes `database: "connected"` with HTTP 200; an observed disconnected/connecting state returns HTTP 503. This endpoint reports Mongoose's connection state, not a separate database ping. A response containing only `status` and `timestamp` indicates the old health handler is still serving requests. Initial connection failures stop startup and must be resolved using the new server logs; the startup fix cannot repair a missing package, invalid `MONGO_URI`, or blocked network access.

## Document Wallet

All wallet operations require a valid login. List, preview and ZIP queries use the email from the database account, never a supplied query email or JWT role. This applies to HR/admin wallets too. Employee accounts cannot access employee management, payroll or letter-creation APIs. Account creation requires an existing HR/admin session; only administrators can create administrators.

Each successful SMTP acceptance records its actual recipient and the exact PDF attachment in private Cloudinary storage. Preview and ZIP download reuse those bytes. SMTP acceptance is not proof of inbox delivery. Failed/pending sends do not appear in wallets. Sent delivery records cannot be deleted through the wallet.

Existing letter records have no trustworthy attachment/delivery history and are intentionally excluded. Resending an existing letter through its send API creates a wallet entry. No historical delivery history was fabricated or migrated. For existing accounts without email, an email-shaped login username is supported; other accounts need an operator to run `node scripts/set-user-email.js USERNAME VERIFIED_EMAIL`. Only use an independently verified employee email, never a user-supplied claim of document ownership.

## Uploads and PDFs

Employee create/update and onboarding uploads use authenticated Cloudinary image/raw storage. JPEG, PNG and PDF uploads are limited to 10 MB each. Failed database requests clean up newly uploaded assets. Old local files remain available through authenticated staff access; they are not automatically moved or deleted. Signed upload URLs act as bearer links and should not be shared. PDF upload URLs expire after one hour; refreshing the employee list issues new links. Wallet PDFs are served through an ownership-checked backend endpoint.

PDF templates render through PHP mPDF (`utils/pdf.php`, driven by `utils/pdfEngine.js`) rather than a headless browser: Chromium's system libraries are unavailable on the shared cPanel host. Run `composer install` in the backend root so mPDF is available. PDF jobs still run sequentially to limit memory use. Do not use this queue as a substitute for a durable worker at high email volume.

## FnF and offboarding

FnF drafts are persisted and editable. All amounts are validated and recalculated on the server in integer paise, including gratuity and notice recovery. Dates are checked. Drafts require asset returns and HR/payroll clearance before approval; approved records are immutable. Sending is separate from payment. Recording disbursement requires a positive payable amount and a bank payment reference; it records a payment already completed outside HRMS and does not initiate a bank transfer. Negative settlements remain recoveries for payroll reconciliation. Statutory eligibility and tax amounts are entered by payroll, not inferred.

The workflow is Draft → Approved → Disbursed, with atomic state changes. Saved records allow email retry without creating another settlement. Offboarding now has a save action and a mounted, protected API. Legacy FnF records marked Settled need separate review; no historical data was silently rewritten.

## Validation

- `npm test`: privacy, authentication, FnF calculation/workflow and six template regressions.
- Frontend: `npm run lint` and `npm run build`.
- `node scripts/check-services.js`: read-only MongoDB, Cloudinary and SMTP authentication checks.
- `node scripts/smoke-uploads.js`: verifies image/PDF multipart uploads and signed downloads, then deletes its synthetic assets.
- `node scripts/smoke-pdf.js`: generates a synthetic PDF, verifies private Cloudinary upload/download byte equality, then deletes its test asset. Sends no email.

No live HR email or real payment was sent in this review. Production origin configuration, account-email mapping, real mailbox delivery and browser acceptance testing remain deployment checks. There is no measured production load-speed guarantee. Page splitting, lazy images, debounced wallet search, indexed recipient queries and removal of redundant employee requests reduce avoidable work.
