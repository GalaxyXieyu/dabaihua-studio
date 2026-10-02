import { env } from "cloudflare:workers";
import { handleDatasetRequest } from "../../../../lib/private-data-api";

export async function GET(request: Request) {
  return handleDatasetRequest(request, env, "career");
}

export async function PUT(request: Request) {
  return handleDatasetRequest(request, env, "career");
}
