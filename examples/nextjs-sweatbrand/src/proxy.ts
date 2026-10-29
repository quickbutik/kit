import { NextResponse, type NextRequest } from "next/server";
import { languages, localePath, preferredLanguage } from "@/lib/localization";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const segment = pathname.split("/")[1];
  const language = languages.find(
    (item) => item.locale.toLowerCase() === segment.toLowerCase(),
  );
  if (language?.locale === segment) return;
  const url = request.nextUrl.clone();
  url.pathname = language
    ? localePath(language.code, pathname.slice(segment.length + 1) || "/")
    : localePath(
        preferredLanguage(request.headers.get("accept-language") ?? ""),
        pathname,
      );
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next.js internals and files such as /images/... and /icon.svg.
  matcher: ["/((?!_next/|.*\\..*).*)"],
};
