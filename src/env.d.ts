type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}

interface Env {
  ADMIN_AUTH?: string;
  ADMIN_LOGIN_LIMITER?: import("./server/admin-auth").AuthEnvironment["ADMIN_LOGIN_LIMITER"];
}

declare namespace App {
  interface Locals {
    adminSession?: import("./server/admin-auth").AdminSession | null;
    adminConfigured?: boolean;
    adminNonce?: string;
  }
}
