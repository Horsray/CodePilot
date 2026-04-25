#!/usr/bin/env python3
"""本地 MCP stdio 代理，通过 Bing 搜索网页"""

import json
import re
import httpx
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("hueying-websearch")


@mcp.tool()
def web_search(query: str, count: int = 5) -> str:
    """搜索网页，返回标题、链接和摘要"""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    results = []
    try:
        with httpx.Client(timeout=15, follow_redirects=True) as client:
            resp = client.get(
                "https://cn.bing.com/search",
                params={"q": query, "count": count},
                headers=headers,
            )
            items = re.findall(
                r"<li\s+class=\"b_algo\"[^>]*>(.*?)</li>", resp.text, re.DOTALL
            )
            for item in items[:count]:
                title_m = re.search(
                    r"<a[^>]*href=\"([^\"]+)\"[^>]*>(.*?)</a>", item, re.DOTALL
                )
                snippet_m = re.search(r"<p[^>]*>(.*?)</p>", item, re.DOTALL)
                if title_m:
                    url = title_m.group(1)
                    title = re.sub(r"<[^>]+>", "", title_m.group(2)).strip()
                    snippet = (
                        re.sub(r"<[^>]+>", "", snippet_m.group(1)).strip()
                        if snippet_m
                        else ""
                    )
                    results.append({"title": title, "url": url, "snippet": snippet})
    except Exception as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)
    return json.dumps(results, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    mcp.run(transport="stdio")
