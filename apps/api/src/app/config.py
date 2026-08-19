from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://postgres:postgres@localhost:5432/postgres"
    tavily_api_key: str = ""
    openai_api_key: str = ""

    cheap_model: str = ""
    strong_model: str = ""
    cheap_reasoning_effort: str = "low"
    strong_reasoning_effort: str = "high"

    fetch_timeout_s: float = 10.0
    max_job_text_chars: int = 40_000
    branch_timeout_s: float = 25.0
    total_deadline_s: float = 90.0
    stale_queued_threshold_s: float = 900.0
    # running rows older than this since creation are treated as zombies —
    # comfortably beyond total_deadline_s + dispatch latency so a legit
    # in-flight run is never swept
    zombie_running_threshold_s: float = 300.0

settings = Settings()
