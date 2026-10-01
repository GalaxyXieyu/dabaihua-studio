import { env } from "cloudflare:workers";
import { ensureSchema } from "../../../../../lib/store";
import { handleCardsRequest } from "../../../../../lib/cards-api";
import { checkSameOrigin, resolveAdmin } from "../../../../../lib/cards-auth";

async function cards(request: Request) {
  await ensureSchema(env.DB);
  return handleCardsRequest(request, {
    db: env.DB,
    assistantToken: env.DABAIHUA_CARDS_ASSISTANT_TOKEN,
    resolveAdmin,
    checkSameOrigin,
  });
}

export async function GET(request: Request) {
  return cards(request);
}

export async function POST(request: Request) {
  return cards(request);
}
