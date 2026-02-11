import { rewrite, next } from "@vercel/functions";

const CRAWLER_PATTERNS = [
  /WhatsApp/i,
  /TelegramBot/i,
  /facebookexternalhit/i,
  /Facebot/i,
  /Twitterbot/i,
  /LinkedInBot/i,
  /Slackbot/i,
  /Discordbot/i,
  /Embedly/i,
  /SkypeUriPreview/i,
  /Slurp/i, // Yahoo
  /Googlebot/i,
  /bingbot/i,
];

function isCrawler(ua: string): boolean {
  return CRAWLER_PATTERNS.some((p) => p.test(ua));
}

export const config = {
  matcher: ["/((?!api/|__/|icons/|favicon|manifest|sw\\.js|.*\\.(?:js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$).*)"],
};

export default function middleware(request: Request) {
  const ua = request.headers.get("user-agent") || "";
  if (!isCrawler(ua)) {
    return next();
  }

  const url = new URL(request.url);
  const ssrUrl = new URL("/api/ssr-html", url.origin);
  ssrUrl.searchParams.set("url", url.href);

  return rewrite(ssrUrl);
}
