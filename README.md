# Cinci Beauty Spa: booking site, admin dashboard and notifications

Firebase project: **cinci-b**. Public site: `public/index.html`. Staff dashboard: `public/admin.html` (at `/admin.html`).

## 1. One-time setup in the Firebase console
1. **Firestore Database**: Build > Firestore Database > Create database (production mode).
2. **Authentication**: Build > Authentication > Get started > Sign-in method > enable **Email/Password**.
3. Use the registration page at `/admin.html` to create staff accounts.
4. **Upgrade to the Blaze plan** before deploying Cloud Functions for automated email/SMS notifications and reminders. Customers can submit bookings and download a PDF receipt without Functions. Booking contact details are format-checked only; email and SMS verification codes are not used.

## 2. Install and deploy
```
npm install -g firebase-tools
firebase login
cd functions && npm install && cd ..
firebase deploy --only database,firestore,hosting
```
This deploys the site and database rules without Cloud Functions. Customers can submit bookings without Functions; automated booking notifications and reminders require Functions deployment and configured provider secrets. Admin price editing and customer review moderation are also available without Functions.
Your site is live at https://cinci-b.web.app. Add your own domain under Hosting > Add custom domain.

## 3. Create staff accounts and assign roles
1. Open `/admin.html` and choose **Create an account**. New users receive a Firestore document at `users/{uid}` with `role: "pending"` and cannot see bookings.
2. In Firebase Console > Firestore Database > `users` > the user's UID document, change `role` from `pending` to `admin`. The user can then press **Check access** or sign in again.
3. Only assign `admin` to trusted staff. This role allows access to bookings, price management, price history, review moderation, and deletion of published reviews.

To create an existing Firebase Authentication user profile or assign the admin role from the command line:
1. Project settings > Service accounts > Generate new private key. Save the file outside this folder and never share it.
2. Run:
```
cd functions
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\key.json"
node set-admin.js you@example.com
```
3. Open `/admin.html` and sign in. Roles are read from Firestore `users/{uid}.role`, not Authentication custom claims.

## 4. Email and SMS (sent by the server, keys never in the website)
1. Create accounts at **Resend** (email) and **Twilio** or **Clickatell** (SMS). Verify your sending domain in Resend.
2. Store the keys as Firebase secrets (you are prompted to paste each value):
```
firebase functions:secrets:set RESEND_API_KEY
firebase functions:secrets:set TWILIO_SID
firebase functions:secrets:set TWILIO_TOKEN
firebase functions:secrets:set TWILIO_FROM
```
3. Edit `EMAIL_FROM` in `functions/index.js` to your verified address, install the Functions dependencies, then:
```
npm --prefix .\functions install
node --check .\functions\index.js
node --check .\functions\booking.js
firebase deploy --only functions:default
```
Cloud Functions deployment requires the Blaze plan. The default codebase provides automated booking notifications, status-update receipts, and reminders. Customers enter a valid email address and a 10-digit mobile number; these values are checked for format but are not verified with a code. SMS updates require a South African mobile number. Customers choose whether updates should be sent by email or SMS. Booking records and slots are created atomically in Firestore, and the downloadable PDF receipt is generated in the browser.

The admin dashboard seeds the initial service catalog from `public/services.json` the first time a staff admin opens it. Price changes and their staff-account audit records are saved atomically. Review submissions are held for approval; admins can approve or reject them, and only approved reviews are displayed publicly. SMS sender IDs and South African numbers may require Twilio approval. If you use another SMS provider, replace `sendSms` in `functions/index.js`.

## How it protects your data
- Customers cannot read booking or staff-profile data. Firestore Rules validate booking fields, the current service price, and the paired slot reservation; only admins can read and manage bookings. Because contact verification is intentionally omitted, public booking is more vulnerable to spam; enable Firebase App Check before broad promotion.
- Public service prices contain no staff contact details. Price history, including the staff account that made each change, is admin-only.
- Customer reviews are public only after an administrator approves them.
- Each booked time is its own document (`date_time`), so two people cannot book the same slot.
- The Firebase web config in the pages is public by design; the rules above are what protect the data. Optionally turn on **App Check** to limit spam bookings.
