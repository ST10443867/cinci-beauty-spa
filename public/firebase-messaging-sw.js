importScripts("https://www.gstatic.com/firebasejs/13.2.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/13.2.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDSbAWm3iBmZOfqksCiH2zXdHo4SX2r7qs",
  authDomain: "cinci-b.firebaseapp.com",
  projectId: "cinci-b",
  storageBucket: "cinci-b.firebasestorage.app",
  messagingSenderId: "290015394750",
  appId: "1:290015394750:web:72e224b5d8a3e1bb8917ef",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  self.registration.showNotification(notification.title || "Cinci Beauty Spa", {
    body: notification.body || "You have a new contact message.",
    icon: "/logo.png",
    data: { url: payload.data?.url || "/admin.html#messages" },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
