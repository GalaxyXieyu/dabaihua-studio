declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    MEDIA: R2Bucket;
    IMPORT_TOKEN?: string;
    DABAIHUA_TRUSTED_PROXY_HOSTS?: string;
    DABAIHUA_ALLOW_REGISTER?: string;
    DABAIHUA_REGISTER_INVITE_CODE?: string;
    DABAIHUA_PUBLIC_BASE_URL?: string;
    DABAIHUA_CARDS_ASSISTANT_TOKEN?: string;
    ARTICLES_OWNER_ACCOUNT?: string;
    SHUFANGZHAI_WEBHOOK_URL?: string;
    SHUFANGZHAI_WEBHOOK_SECRET?: string;
    SHUFANGZHAI_WEBHOOK_AUTH_HEADER?: string;
    AI?: {
      run(model: string, input: unknown): Promise<unknown>;
    };
  }
}
