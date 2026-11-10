// Usage: node set-admin.js staff@example.com
// Needs GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key (see README).
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cinci-b" });
const email = process.argv[2];
if (!email) { console.error("Give the staff email address."); process.exit(1); }
admin.auth().getUserByEmail(email)
  .then((u) => admin.firestore().collection("users").doc(u.uid).set({
    uid: u.uid,
    email: u.email,
    displayName: u.displayName || email.split("@")[0],
    role: "admin",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }))
  .then(() => console.log(email + " now has the admin role in Firestore. Refresh the admin page to apply it."))
  .catch((e) => { console.error(e.message); process.exit(1); });
