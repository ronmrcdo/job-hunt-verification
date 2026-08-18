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

class FinalAssessment(BaseModel):
    band: Band
    confidence: Confidence
    summary: str
    coverage: float

class InvestigationState(BaseModel):
    submission: RawSubmission
    entities: ExtractedEntities = Field(default_factory=ExtractedEntities)
    sources: list[Source] = Field(default_factory=list)
    deterministic_signals: dict = Field(default_factory=dict)
    findings: list[Finding] = Field(default_factory=list)
    unresolved_questions: list[str] = Field(default_factory=list)
    research_attempts: int = 0
    cost_events: Annotated[list[NodeUsage], operator.add] = Field(default_factory=list)
    assessment: FinalAssessment | None = None
