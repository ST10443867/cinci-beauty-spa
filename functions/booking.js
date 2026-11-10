function pdfEscape(value) {
  return String(value).normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function makeReceiptPdf(booking, bookingId) {
  const lines = [
    "CINCI BEAUTY SPA - BOOKING RECEIPT",
    `Receipt: ${bookingId}`,
    `Customer: ${booking.name}`,
    `Service: ${booking.service}`,
    `Price: ${booking.price}`,
    `Appointment: ${booking.date} at ${booking.time} (Africa/Johannesburg)`,
    `Email: ${booking.email}`,
    `Phone: ${booking.phone}`,
    "This receipt confirms a booking; it is not proof of payment.",
    "Premium Towers, 3rd Floor, Room 306, 296 Pretorius Street, Pretoria Central.",
  ];
  const text = lines.map((line, index) =>
    `/F1 ${index === 0 ? 16 : 11} Tf 1 0 0 1 50 ${780 - index * 36} Tm (${pdfEscape(line)}) Tj`
  ).join("\n");
  const stream = `BT\n${text}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}

function registerBookingFunctions(exports, deps) {
  const { admin, onCall, HttpsError, REGION } = deps;
  const db = admin.firestore();

  function validPriceLabel(value) {
    if (typeof value !== "string") return false;
    const match = /^\+?R((?:[0-9]{1,3}(?:,[0-9]{3})+)|[0-9]+)$/.exec(value);
    if (!match) return false;
    const amount = Number(match[1].replace(/,/g, ""));
    return Number.isSafeInteger(amount) && amount > 0 && amount <= 999999999;
  }

  function serviceIdFor(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  exports.seedServicePrices = onCall({ region: REGION, maxInstances: 5 }, async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in with a staff account.");
    const profile = await db.collection("users").doc(uid).get();
    if (!profile.exists || profile.data().role !== "admin") {
      throw new HttpsError("permission-denied", "An administrator role is required.");
    }
    const catalog = request.data && request.data.catalog;
    if (!Array.isArray(catalog) || catalog.length < 1 || catalog.length > 60) {
      throw new HttpsError("invalid-argument", "The service catalog is invalid.");
    }
    const actorEmail = request.auth.token.email || "";
    for (const service of catalog) {
      if (!service || typeof service.name !== "string" || service.name.length > 100 ||
          service.id !== serviceIdFor(service.name) || !validPriceLabel(service.priceLabel)) {
        throw new HttpsError("invalid-argument", "A service in the catalog is invalid.");
      }
      const serviceRef = db.collection("servicePrices").doc(service.id);
      await db.runTransaction(async (transaction) => {
        if ((await transaction.get(serviceRef)).exists) return;
        const auditRef = db.collection("priceAudit").doc();
        const now = admin.firestore.FieldValue.serverTimestamp();
        transaction.create(serviceRef, {
          serviceId: service.id,
          serviceName: service.name,
          priceLabel: service.priceLabel,
          updatedAt: now,
          lastAuditId: auditRef.id,
        });
        transaction.create(auditRef, {
          serviceId: service.id,
          serviceName: service.name,
          previousPrice: "Not set",
          newPrice: service.priceLabel,
          changedByUid: uid,
          changedByEmail: actorEmail,
          changedAt: now,
        });
      });
    }
    return { seeded: catalog.length };
  });

  exports.updateServicePrice = onCall({ region: REGION, maxInstances: 5 }, async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in with a staff account.");
    const profile = await db.collection("users").doc(uid).get();
    if (!profile.exists || profile.data().role !== "admin") {
      throw new HttpsError("permission-denied", "An administrator role is required.");
    }
    const { serviceId, priceLabel } = request.data || {};
    if (typeof serviceId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(serviceId) ||
        !validPriceLabel(priceLabel)) {
      throw new HttpsError("invalid-argument", "Enter a valid service price.");
    }
    const serviceRef = db.collection("servicePrices").doc(serviceId);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(serviceRef);
      if (!snapshot.exists) throw new HttpsError("not-found", "Service price was not found.");
      const service = snapshot.data();
      if (service.priceLabel === priceLabel) return;
      const auditRef = db.collection("priceAudit").doc();
      const now = admin.firestore.FieldValue.serverTimestamp();
      transaction.update(serviceRef, {
        priceLabel,
        updatedAt: now,
        lastAuditId: auditRef.id,
      });
      transaction.create(auditRef, {
        serviceId,
        serviceName: service.serviceName,
        previousPrice: service.priceLabel,
        newPrice: priceLabel,
        changedByUid: uid,
        changedByEmail: request.auth.token.email || "",
        changedAt: now,
      });
    });
    return { updated: true };
  });

  exports.moderateReview = onCall({ region: REGION, maxInstances: 5 }, async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in with a staff account.");
    const profile = await db.collection("users").doc(uid).get();
    if (!profile.exists || profile.data().role !== "admin") {
      throw new HttpsError("permission-denied", "An administrator role is required.");
    }
    const { reviewId, approved } = request.data || {};
    if (typeof reviewId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(reviewId) ||
        typeof approved !== "boolean") {
      throw new HttpsError("invalid-argument", "Review moderation request is invalid.");
    }
    const reviewRef = db.collection("reviews").doc(reviewId);
    if (approved) {
      await reviewRef.update({ approved: true });
    } else {
      await reviewRef.delete();
    }
    return { moderated: true };
  });

}

module.exports = { registerBookingFunctions, makeReceiptPdf };
