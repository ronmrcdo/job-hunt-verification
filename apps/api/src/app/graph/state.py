import operator
from typing import Annotated, Literal
from datetime import datetime
from pydantic import BaseModel, Field
from app.cost_tracker import NodeUsage

Category = Literal["company", "job", "recruiter", "domain", "communication", "cross_source"]
Direction = Literal["legitimizing", "suspicious", "unverifiable"]
Severity = Literal["info", "low", "medium", "high", "critical"]
Provenance = Literal["web_verified", "deterministic", "user_provided_unverified"]
Band = Literal["LOW", "MODERATE", "HIGH", "CRITICAL"]
Confidence = Literal["LOW", "MODERATE", "HIGH"]

class RawSubmission(BaseModel):
    job_text: str
    company_name: str | None = None
    recruiter_email: str | None = None
    job_url: str | None = None
    # V1 only; present so state shape is stable. No V0 UI populates it.
    conversation_text: str | None = None

class ExtractedEntities(BaseModel):
    company_name: str | None = None
    company_domain: str | None = None
    candidate_real_domain: str | None = None  # what the company's real domain appears to be
    recruiter_email: str | None = None
    job_title: str | None = None
    salary: str | None = None
    recruiter_name: str | None = None
    contact_channel: str | None = None
    job_url: str | None = None
    key_phrases: list[str] = Field(default_factory=list)

class Source(BaseModel):
    id: str
    url: str | None = None
    kind: Literal["search_result", "fetched_page", "whois", "dns", "user_provided"]
    retrieved_at: datetime
    content_summary: str
    raw_excerpt: str | None = None

class Finding(BaseModel):
    id: str
    category: Category
    direction: Direction
    severity: Severity
    claim: str
    source_ids: list[str] = Field(default_factory=list)
    provenance: Provenance
    mitigation: str | None = None
    # §9.7: this finding is a request for the user to take a compromising
    # action (run an executable, log in on a non-company site). Surfaces as an
    # unconditional safety callout; never raises the named company's band.
    user_safety_alert: bool = False

class FinalAssessment(BaseModel):
    band: Band
    confidence: Confidence
    summary: str
    coverage: float

class InvestigationState(BaseModel):
    submission: RawSubmission
    entities: ExtractedEntities = Field(default_factory=ExtractedEntities)
    # Populated by the url_fetch node from a submitted link (spec §11 URL
    # submission). Kept separate from the immutable submission so the pasted
    # posting and the fetched page stay distinguishable end to end.
    fetched_posting: str | None = None
    fetch_failed: bool = False
    sources: list[Source] = Field(default_factory=list)
    # Pre-dedupe accumulators for the parallel fan-out branches (checks/research/
    # crosspost). Additive so concurrent writers in the same superstep merge
    # instead of conflicting (InvalidUpdateError) — mirrors cost_events below.
    # evidence_assembly consumes these, assigns canonical IDs, and writes the
    # final (replace-semantics) `sources`/`findings`. Never expose raw_* outside
    # the graph (e.g. in API responses) — only the canonical fields are public.
    raw_sources: Annotated[list[Source], operator.add] = Field(default_factory=list)
    deterministic_signals: dict = Field(default_factory=dict)
    findings: list[Finding] = Field(default_factory=list)
    raw_findings: Annotated[list[Finding], operator.add] = Field(default_factory=list)
    unresolved_questions: list[str] = Field(default_factory=list)
    research_attempts: int = 0
    cost_events: Annotated[list[NodeUsage], operator.add] = Field(default_factory=list)
    assessment: FinalAssessment | None = None
