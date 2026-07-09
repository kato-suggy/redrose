/** Worker bindings — D1 plus the four secrets from .dev.vars / wrangler secret. */
export type Bindings = {
  DB: D1Database;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  RESEND_API_KEY: string;
  ADMIN_PASSWORD: string;
};
