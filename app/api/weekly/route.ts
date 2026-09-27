import { env } from "cloudflare:workers";
import { authenticateApiKey } from "../../../lib/auth";
import { listWeeklyReports, publicBaseUrl } from "../../../lib/weekly";

export async function GET(request: Request) {
  const auth = await authenticateApiKey(env, request);
  if (auth.status !== "ok") {
    return Response.json(
      { error: auth.status === "invalid" ? "invalid key" : "unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const base = publicBaseUrl(env, request);
  const reports = await listWeeklyReports(env, auth.user.id);
  return Response.json(
    {
      reports: reports.map((report) => ({
        week: report.week,
        url: `${base}/weekly/${report.week}/`,
        bytes: report.bytes,
        updated_at: report.updatedAt,
      })),
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
