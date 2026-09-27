import { env } from "cloudflare:workers";
import { authErrorResponse, getSessionUser, loginUser, logoutUser, registerUser } from "../../../lib/auth";

export async function GET(request: Request) {
  try {
    return Response.json({ user: await getSessionUser(env, request) });
  } catch (error) {
    return authErrorResponse(error, "读取登录状态失败");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: "register" | "login" | "logout"; account?: string; password?: string; confirmPassword?: string; nickname?: string; inviteCode?: string };
    if (body.action === "register") {
      const result = await registerUser(env, request, body);
      return Response.json({ user: result.user }, { headers: { "set-cookie": result.cookie } });
    }
    if (body.action === "login") {
      const result = await loginUser(env, request, body);
      return Response.json({ user: result.user }, { headers: { "set-cookie": result.cookie } });
    }
    if (body.action === "logout") {
      const cookie = await logoutUser(env, request);
      return Response.json({ ok: true }, { headers: { "set-cookie": cookie } });
    }
    return Response.json({ error: "登录操作不合法" }, { status: 400 });
  } catch (error) {
    return authErrorResponse(error, "登录操作失败");
  }
}
