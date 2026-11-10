const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { registerBookingFunctions, makeReceiptPdf } = require("./booking");
admin.initializeApp();

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const TWILIO_SID = defineSecret("TWILIO_SID");
const TWILIO_TOKEN = defineSecret("TWILIO_TOKEN");
const TWILIO_FROM = defineSecret("TWILIO_FROM"); // your Twilio number or approved sender ID
const EMAIL_FROM = defineString("EMAIL_FROM", { default: "Cinci Beauty Spa <onboarding@resend.dev>" });
const SECRETS = [RESEND_API_KEY, TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM];
const REGION = "us-central1";
const SIGN = "Cinci Beauty Spa, Premium Towers, 3rd Floor, Room 306, 296 Pretorius Street, Pretoria Central. 067 708 5887";

function message(kind, b) {
  const what = `${b.service} on ${b.date} at ${b.time}`;
  const lines = {
    received: [`We received your booking`, `Hi ${b.name}, we received your booking for ${what}. We will confirm it shortly.`],
    Confirmed: [`Your booking is confirmed`, `Hi ${b.name}, your booking for ${what} is confirmed.`],
    Cancelled: [`Your booking was cancelled`, `Hi ${b.name}, your booking for ${what} was cancelled. Call us to rebook.`],
    rescheduled: [`Your booking was rescheduled`, `Hi ${b.name}, your booking was moved to ${what}.`],
    reminder: [`Reminder: your appointment tomorrow`, `Hi ${b.name}, a reminder of your appointment tomorrow: ${what}.`],
  }[kind];
  return { subject: lines[0], text: `${lines[1]}\n\n${SIGN}` };
}

async function sendEmail(to, m, attachments = []) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY.value()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM.value(), to: [to], subject: m.subject, text: m.text, attachments }),
  });
  if (!r.ok) throw new Error(`Email failed: ${r.status} ${await r.text()}`);
}

async function sendSms(to, m) {
  const sid = TWILIO_SID.value();
  const destination = to.startsWith("0") ? `+27${to.slice(1)}` : to;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${TWILIO_TOKEN.value()}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: destination, From: TWILIO_FROM.value(), Body: `${m.subject}. ${m.text}` }),
  });
  if (!r.ok) throw new Error(`SMS failed: ${r.status} ${await r.text()}`);
}

async function notify(kind, b, attachments = []) {
  const m = message(kind, b);
  if (b.contactChannel === "email") {
    await sendEmail(b.email, m, attachments);
  } else if (b.contactChannel === "sms") {
    await sendSms(b.phone, m);
  } else {
    throw new Error("Booking has no valid contact channel.");
  }
}

exports.onBookingCreated = onDocumentCreated(
  { document: "bookings/{id}", region: REGION, secrets: SECRETS },
  (e) => notify("received", e.data.data())
);

exports.onBookingUpdated = onDocumentUpdated(
  { document: "bookings/{id}", region: REGION, secrets: SECRETS },
  (e) => {
    const a = e.data.before.data(), b = e.data.after.data();
    if (a.date !== b.date || a.time !== b.time) return notify("rescheduled", b);
    if (a.status !== b.status && (b.status === "Confirmed" || b.status === "Cancelled")) {
      const attachments = b.status === "Confirmed" ? [{
        filename: `cinci-receipt-${e.data.after.id}.pdf`,
        content: makeReceiptPdf(b, e.data.after.id).toString("base64"),
      }] : [];
      return notify(b.status, b, attachments);
    }
  }
);

exports.dailyReminders = onSchedule(
  { schedule: "0 8 * * *", timeZone: "Africa/Johannesburg", region: REGION, secrets: SECRETS },
  async () => {
    const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
    const snap = await admin.firestore().collection("bookings")
      .where("date", "==", tomorrow).where("status", "==", "Confirmed").get();
    await Promise.all(snap.docs.map((d) => notify("reminder", d.data())));
  }
);

registerBookingFunctions(exports, {
  admin,
  onCall,
  HttpsError,
  REGION,
});
