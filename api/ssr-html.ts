import type { VercelRequest, VercelResponse } from "@vercel/node";

const DEFAULT_TITLE = "COPE - Social Trading App";
const DEFAULT_DESCRIPTION =
  "Social trading app for cryptocurrency trading and wallet management";

interface MetaInput {
  title: string;
  description: string;
  ogImage?: string;
  ogType?: "website" | "profile";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function injectMeta(html: string, meta: MetaInput, canonicalUrl: string): string {
  const title = escapeHtml(meta.title);
  const desc = escapeHtml(meta.description);
  const image = meta.ogImage ? escapeHtml(meta.ogImage) : "";
  const type = meta.ogType || "website";

  const metaTags = [
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${desc}" />`,
  ];
  if (image) {
    metaTags.push(`<meta property="og:image" content="${image}" />`);
    metaTags.push(`<meta name="twitter:image" content="${image}" />`);
  }

  // Replace existing meta and title, or insert before </head>
  let out = html;

  // Remove existing title and meta we'll replace
  out = out.replace(/<title>[\s\S]*?<\/title>/i, "");
  out = out.replace(
    /<meta\s+(?:name|property)=["'](?:description|og:title|og:description|og:type|og:url|og:image|twitter:card|twitter:title|twitter:description|twitter:image)["'][^>]*>/gi,
    ""
  );

  // Insert new meta before </head>
  const insert = metaTags.join("\n    ");
  out = out.replace("</head>", `    ${insert}\n  </head>`);

  return out;
}

async function getMetaForUrl(
  parsedUrl: URL,
  origin: string
): Promise<MetaInput> {
  const pathname = parsedUrl.pathname.replace(/\/$/, "") || "/";
  const pathSegments = pathname.split("/").filter(Boolean);

  // /app/trade?mint=xxx
  if (
    pathSegments[0] === "app" &&
    pathSegments[1] === "trade" &&
    parsedUrl.searchParams.has("mint")
  ) {
    const mint = parsedUrl.searchParams.get("mint")?.trim();
    if (mint) {
      try {
        const res = await fetch(
          `${origin}/api/birdeye/token-overview?address=${encodeURIComponent(mint)}&chain=solana`
        );
        if (res.ok) {
          const data = (await res.json()) as { data?: { symbol?: string; name?: string } };
          const symbol =
            data?.data?.symbol || data?.data?.name || mint.slice(0, 8);
          return {
            title: `Trade ${symbol} | COPE`,
            description: `Trade ${symbol} on COPE - Catch onchain plays early`,
          };
        }
      } catch {
        // fall through to default
      }
      return {
        title: `Trade | COPE`,
        description: `Trade this token on COPE - Catch onchain plays early`,
      };
    }
  }

  // /:handle (public profile) - single segment, not app/auth/cope/etc
  const reserved = new Set([
    "app",
    "auth",
    "cope",
    "watchlist",
    "scanner",
    "token",
    "lopam",
    "wallet",
  ]);
  if (pathSegments.length === 1 && !reserved.has(pathSegments[0].toLowerCase())) {
    const handle = pathSegments[0];
    try {
      const res = await fetch(
        `${origin}/api/profile/by-handle?handle=${encodeURIComponent(handle)}`
      );
      if (res.ok) {
        const data = (await res.json()) as {
          xHandle?: string;
          displayName?: string;
          avatar?: string | null;
        };
        const displayName = data.xHandle || data.displayName || `@${handle}`;
        const desc = `View ${displayName}'s wallet, positions, and PnL on COPE`;
        const ogImage =
          data.avatar && data.avatar.startsWith("http")
            ? data.avatar
            : undefined;
        return {
          title: `${displayName} | COPE`,
          description: desc,
          ogImage: ogImage || undefined,
          ogType: "profile",
        };
      }
    } catch {
      // fall through
    }
  }

  return {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).setHeader("Allow", "GET").end();
    return;
  }

  const rawUrl = (req.query.url as string) || "";
  if (!rawUrl) {
    res.status(400).json({ error: "Missing url" });
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    res.status(400).json({ error: "Invalid url" });
    return;
  }

  const origin =
    process.env.VERCEL_URL && !process.env.VERCEL_URL.includes("localhost")
      ? `https://${process.env.VERCEL_URL}`
      : parsedUrl.origin;

  try {
    const [meta, htmlRes] = await Promise.all([
      getMetaForUrl(parsedUrl, origin),
      fetch(`${origin}/`, {
        headers: {
          "User-Agent": "COPE-SSR-Meta/1.0",
          Accept: "text/html",
        },
      }),
    ]);

    if (!htmlRes.ok) {
      res.status(502).json({
        error: `Failed to fetch base HTML: ${htmlRes.status}`,
      });
      return;
    }

    const html = await htmlRes.text();
    const canonicalUrl = parsedUrl.href.split("?")[0];
    const injected = injectMeta(html, meta, canonicalUrl);

    res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(injected);
  } catch (e) {
    console.error("[ssr-html] Error:", e);
    res
      .status(500)
      .json({ error: e instanceof Error ? e.message : "Internal server error" });
  }
}
