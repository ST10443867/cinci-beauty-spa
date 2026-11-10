(function (global) {
  const encoder = new TextEncoder();
  let logoPromise;

  function encode(text) {
    return encoder.encode(text);
  }

  function joinBytes(chunks) {
    const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    chunks.forEach((chunk) => {
      result.set(chunk, offset);
      offset += chunk.length;
    });
    return result;
  }

  function escapeText(value) {
    return String(value ?? "").normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }

  function formatPrice(value) {
    const amount = Number(String(value || "").replace(/[^\d]/g, ""));
    return Number.isSafeInteger(amount) ? amount : 0;
  }

  function formatRand(value) {
    return "R" + value.toLocaleString("en-US");
  }

  function wrapLine(value, width) {
    const words = String(value).split(/\s+/);
    const lines = [];
    let line = "";
    words.forEach((word) => {
      while (word.length > width) {
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (line && (line + " " + word).length > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? line + " " + word : word;
      }
    });
    if (line) lines.push(line);
    return lines;
  }

  function createdAtLabel(value) {
    if (value && typeof value.toDate === "function") return value.toDate().toLocaleString();
    if (value instanceof Date) return value.toLocaleString();
    return value || "Not recorded";
  }

  async function loadLogo() {
    if (!logoPromise) {
      logoPromise = fetch("/logo.jpg").then((response) => {
        if (!response.ok) throw new Error("Could not load the Cinci logo for the PDF.");
        return response.arrayBuffer();
      }).then((bytes) => new Uint8Array(bytes));
    }
    return logoPromise;
  }

  async function create(booking, bookingId) {
    const logo = await loadLogo();
    const items = Array.isArray(booking.items) && booking.items.length
      ? booking.items
      : [{ service: booking.service, price: booking.price, quantity: 1 }];
    const total = items.reduce((sum, item) =>
      sum + formatPrice(item.price) * (Number(item.quantity) || 1), 0);
    const lines = [
      "Booking reference: " + bookingId,
      "Client: " + booking.name,
      "Email: " + booking.email,
      "Mobile: " + booking.phone,
      "Updates via: " + (booking.contactChannel || "Not specified"),
      "Appointment: " + booking.date + " at " + booking.time + " (Africa/Johannesburg)",
      "Status: " + (booking.status || "Pending"),
      "Services:",
    ];
    items.forEach((item) => {
      lines.push("- " + item.service + " x" + (Number(item.quantity) || 1) + " @ " + item.price);
    });
    lines.push(
      "Estimated total: " + formatRand(total),
      "Booking received: " + createdAtLabel(booking.createdAt),
      "Cinci Beauty Spa",
      "Premium Towers, 3rd Floor, Room 306, 296 Pretorius Street, Pretoria Central.",
      "Phone: 067 708 5887  |  Email: cincibeautyspa@gmail.com",
      "This document confirms booking details; it is not proof of payment."
    );

    let y = 710;
    const text = lines.flatMap((line) => wrapLine(line, 88)).map((line) => {
      const command = "/F1 10 Tf 1 0 0 1 50 " + y + " Tm (" + escapeText(line) + ") Tj";
      y -= 18;
      return command;
    }).join("\n");
    const content = encode(
      "q\n64 0 0 69 50 745 cm\n/Logo Do\nQ\n" +
      "BT\n/F1 17 Tf 1 0 0 1 135 790 Tm (CINCI BEAUTY SPA) Tj\n" +
      "/F1 12 Tf 1 0 0 1 135 768 Tm (CLIENT BOOKING DETAILS) Tj\n" +
      "0.36 0.37 0.38 RG 50 730 m 562 730 l S\n" + text + "\nET"
    );
    const objects = [
      encode("<< /Type /Catalog /Pages 2 0 R >>"),
      encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
      encode("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> /XObject << /Logo 6 0 R >> >> /Contents 5 0 R >>"),
      encode("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
      joinBytes([
        encode("<< /Length " + content.length + " >>\nstream\n"),
        content,
        encode("\nendstream"),
      ]),
      joinBytes([
        encode("<< /Type /XObject /Subtype /Image /Width 768 /Height 829 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + logo.length + " >>\nstream\n"),
        logo,
        encode("\nendstream"),
      ]),
    ];
    const header = encode("%PDF-1.4\n");
    const chunks = [header];
    const offsets = [0];
    let offset = header.length;
    objects.forEach((object, index) => {
      const prefix = encode((index + 1) + " 0 obj\n");
      const suffix = encode("\nendobj\n");
      offsets.push(offset);
      chunks.push(prefix, object, suffix);
      offset += prefix.length + object.length + suffix.length;
    });
    const xrefOffset = offset;
    let xref = "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
    offsets.slice(1).forEach((itemOffset) => {
      xref += String(itemOffset).padStart(10, "0") + " 00000 n \n";
    });
    xref += "trailer\n<< /Size " + (objects.length + 1) +
      " /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF";
    chunks.push(encode(xref));
    return joinBytes(chunks);
  }

  global.cinciPdf = { create };
})(window);
