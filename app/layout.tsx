import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "@fontsource-variable/noto-serif-sc";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/newsreader/wght-italic.css";
import "./globals.css";
import { BRAND_NAME, BRAND_TITLE } from "../lib/brand";
import { requestOrigin } from "../lib/request-origin";

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// 防闪脚本：在首次绘制前根据 localStorage 与当前路径决定侧栏收起状态。
// 决策逻辑与 lib/site-nav.ts 的 navStateFor 保持一致（纯函数不可在防闪脚本里 import）。
const NAV_INIT_SCRIPT = `(function(){try{var p=location.pathname;var r=p==="/discover"||p.indexOf("/discover/")===0||p==="/reading"||p.indexOf("/reading/")===0;var v=r?(localStorage.getItem("dbh-nav-reader")==="expanded"?"expanded":"collapsed"):(localStorage.getItem("dbh-nav")==="collapsed"?"collapsed":"expanded");document.documentElement.dataset.nav=v;}catch(e){}})();`;

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const siteUrl = new URL(requestOrigin(requestHeaders));
  const title = BRAND_TITLE;
  const description = "一起阅读、炼化心结、贡献订阅源，发现值得长期关注的 RSS、X 与公众号内容。";
  const image = new URL("/og-community.png", siteUrl).toString();

  return {
    metadataBase: siteUrl,
    title,
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title,
      description,
      url: "/",
      siteName: BRAND_NAME,
      locale: "zh_CN",
      type: "website",
      images: [{ url: image, width: 1728, height: 910, alt: `${BRAND_NAME}的阅读与贡献排行榜` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NAV_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
