type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}

interface Env {
  TURNSTILE_SECRET?: string;
  ADMIN_AUTH?: string;
}

declare namespace App {
  interface Locals {
    adminSession?: import("./server/admin-auth").AdminSession | null;
    adminConfigured?: boolean;
    adminNonce?: string;
  }
}
