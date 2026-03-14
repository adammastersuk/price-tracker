import { NextRequest, NextResponse } from "next/server";

// TEMP DEBUG ROUTE: remove after Bents scraper debugging is complete.

const BENTS_USER_AGENT = "BentsPricingTracker/1.0 (+decision-support)";

function stripTags(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&pound;/gi, "£")
    .replace(/\s+/g, " ")
    .trim();
}

function collectMatches(source: string, pattern: RegExp, limit: number) {
  const matches: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const token = stripTags(match[0] ?? "");
    if (!token) continue;
    matches.push(token);
    if (matches.length >= limit) break;
  }
  return matches;
}

function extractSelectorContent(html: string, selector: "withTax" | "productViewPrice" | "inStock") {
  if (selector === "withTax") {
    const match = html.match(/<span[^>]*data-product-price-with-tax[^>]*>([\s\S]*?)<\/span>/i);
    return match?.[1] ? stripTags(match[1]) : null;
  }

  if (selector === "productViewPrice") {
    const match = html.match(/<[^>]*class=["'][^"']*productView-price[^"']*["'][^>]*>([\s\S]{0,8000}?)<\/[^>]+>/i);
    return match?.[1] ? stripTags(match[1]) : null;
  }

  const match = html.match(/<[^>]*class=["'][^"']*\bin-stock\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  return match?.[1] ? stripTags(match[1]) : null;
}

export async function GET(request: NextRequest) {
  const requestedUrl = request.nextUrl.searchParams.get("url")?.trim();
  if (!requestedUrl) {
    return NextResponse.json({ error: "url query parameter is required" }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(requestedUrl);
  } catch {
    return NextResponse.json({ error: "url must be a valid absolute URL" }, { status: 400 });
  }

  if (!/^https?:$/i.test(parsedUrl.protocol)) {
    return NextResponse.json({ error: "url must use http or https" }, { status: 400 });
  }

  try {
    const response = await fetch(parsedUrl.toString(), {
      headers: { "User-Agent": BENTS_USER_AGENT },
      cache: "no-store"
    });

    const html = await response.text();
    const contentType = response.headers.get("content-type") ?? null;

    const containsProductPriceWithTax = /data-product-price-with-tax/i.test(html);
    const containsPriceWithTaxClass = /price--withTax/i.test(html);
    const containsProductViewPrice = /productView-price/i.test(html);
    const containsInStock = /\bin-stock\b|in\s+stock/i.test(html);
    const containsAddToBag = /add\s*to\s*bag/i.test(html);

    const matchedPriceSnippets = collectMatches(html, /(?:£|&pound;|GBP)\s?(\d{1,3}(,\d{3})*(\.\d{2})?)/gi, 10);
    const matchedAddToBagSnippets = collectMatches(html, /(?:<button[^>]*>[\s\S]{0,300}?<\/button>|add\s*to\s*bag[^<\n]{0,140})/gi, 5);

    return NextResponse.json({
      requestedUrl: parsedUrl.toString(),
      finalUrl: response.url,
      httpStatus: response.status,
      contentType,
      htmlLength: html.length,
      first2000Chars: html.slice(0, 2000),
      containsProductPriceWithTax,
      containsPriceWithTaxClass,
      containsProductViewPrice,
      containsInStock,
      containsAddToBag,
      matchedPriceSnippets,
      matchedAddToBagSnippets,
      extracted: {
        productPriceWithTax: extractSelectorContent(html, "withTax"),
        productViewPrice: extractSelectorContent(html, "productViewPrice"),
        inStock: extractSelectorContent(html, "inStock")
      },
      debug: {
        temporaryRoute: true,
        removalNote: "Remove /api/debug/bents-fetch after Bents scraper debugging is complete",
        fetchConfig: {
          userAgent: BENTS_USER_AGENT,
          cache: "no-store"
        }
      }
    });
  } catch (error) {
    return NextResponse.json({
      requestedUrl: parsedUrl.toString(),
      error: (error as Error).message
    }, { status: 500 });
  }
}
