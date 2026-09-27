declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    MEDIA: R2Bucket;
    IMPORT_TOKEN?: string;
    DABAIHUA_TRUSTED_PROXY_HOSTS?: string;
    DABAIHUA_ALLOW_REGISTER?: string;
    DABAIHUA_REGISTER_INVITE_CODE?: string;
    AI?: {
      run(model: string, input: unknown): Promise<unknown>;
    };
  }
}
