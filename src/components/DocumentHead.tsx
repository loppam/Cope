import { useEffect } from "react";

const DEFAULT_TITLE = "COPE - Social Trading App";
const DEFAULT_DESCRIPTION =
  "Social trading app for cryptocurrency trading and wallet management";

interface DocumentHeadProps {
  title: string;
  description?: string;
  ogImage?: string | null;
  ogType?: "website" | "profile";
  /** Append "| COPE" to title if not already present. Default true */
  appendBrand?: boolean;
}

function updateMeta(
  name: string,
  content: string,
  isProperty = false
): void {
  const attr = isProperty ? "property" : "name";
  let el = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

export function DocumentHead({
  title,
  description,
  ogImage,
  ogType = "website",
  appendBrand = true,
}: DocumentHeadProps) {
  const fullTitle =
    appendBrand && !title.includes("COPE") ? `${title} | COPE` : title;
  const desc = description ?? DEFAULT_DESCRIPTION;
  const imageUrl =
    ogImage && ogImage.startsWith("http")
      ? ogImage
      : ogImage
        ? `${typeof window !== "undefined" ? window.location.origin : ""}${ogImage.startsWith("/") ? "" : "/"}${ogImage}`
        : undefined;
  const canonicalUrl =
    typeof window !== "undefined"
      ? window.location.href.split("?")[0]
      : "";

  useEffect(() => {
    document.title = fullTitle;

    updateMeta("description", desc);
    updateMeta("og:title", fullTitle, true);
    updateMeta("og:description", desc, true);
    updateMeta("og:type", ogType, true);
    updateMeta("og:url", canonicalUrl, true);
    if (imageUrl) updateMeta("og:image", imageUrl, true);

    updateMeta("twitter:card", "summary_large_image");
    updateMeta("twitter:title", fullTitle);
    updateMeta("twitter:description", desc);
    if (imageUrl) updateMeta("twitter:image", imageUrl);
  }, [fullTitle, desc, imageUrl, ogType, canonicalUrl]);

  return null;
}
