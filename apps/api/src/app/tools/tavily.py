"""Tavily search client: a thin async wrapper returning structured hits.

Uses basic search depth by default (spec §13). Query construction is a
named risk (spec §15), so queries are built by explicit, independently
testable helpers rather than assembled inline at call sites.
"""

import asyncio

from pydantic import BaseModel
from tavily import TavilyClient

from app.config import settings


class SearchHit(BaseModel):
    title: str
    url: str
    content: str


_client: TavilyClient | None = None


def _get_client() -> TavilyClient:
    global _client
    if _client is None:
        _client = TavilyClient(api_key=settings.tavily_api_key)
    return _client


def _raw_search(query: str, max_results: int, search_depth: str) -> dict:
    return _get_client().search(query=query, max_results=max_results, search_depth=search_depth)


async def tavily_search(query: str, *, max_results: int = 5) -> list[SearchHit]:
    """Run a Tavily search off the event loop (tavily-python's client is sync)."""
    data = await asyncio.to_thread(_raw_search, query, max_results, "basic")
    return [
        SearchHit(title=r.get("title", ""), url=r.get("url", ""), content=r.get("content", ""))
        for r in data.get("results", [])
    ]


def build_company_queries(entities) -> list[str]:
    """Queries for verifying the company behind a job posting: scam signals,
    the careers/hiring presence, and the official site as a sanity anchor."""
    name = entities.company_name or ""
    qs = []
    if name:
        qs += [
            f'"{name}" scam OR fraud OR complaint',
            f'"{name}" careers jobs',
            f'"{name}" official website',
        ]
    if entities.company_domain:
        qs.append(f"{entities.company_domain} company reviews")
    return [q for q in qs if q.strip()]


def build_crosspost_queries(entities) -> list[str]:
    """Queries for finding this exact job posting cross-posted elsewhere,
    using an exact-phrase match on the job title to keep results relevant."""
    title = entities.job_title or ""
    name = entities.company_name or ""
    if not title:
        return []
    return [
        f'"{title}" "{name}" job posting',
        f'"{title}" {name} apply contact email',
    ]
