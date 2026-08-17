import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const siteUrl = new URL(`${protocol}://${host}`);
  const title = "清流工作室 · RSS / X / 公众号";
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
      siteName: "清流工作室",
      locale: "zh_CN",
      type: "website",
      images: [{ url: image, width: 1728, height: 910, alt: "清流工作室的阅读与贡献排行榜" }],
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
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
