import { Hono } from "hono";
import type { Bindings } from "./env";
import type { Service } from "./types";
import landing from "./routes/landing";
import treatments from "./routes/treatments";
import booking from "./routes/booking";
import admin from "./routes/admin";

const app = new Hono<{ Bindings: Bindings }>();

// Booking engine: /api/slots, /book, /booking/*, /webhooks/stripe
app.route("/", booking);

// Lorena's admin (basic auth)
app.route("/admin", admin);

// Brochure
app.route("/", landing);
app.route("/", treatments);

app.get("/health", (c) => c.json({ ok: true, service: "redrose" }));

export default app;
export type { Bindings, Service };
