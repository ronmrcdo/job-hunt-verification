from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://postgres:postgres@localhost:5432/postgres"
    tavily_api_key: str = ""
    openai_api_key: str = ""
    # Point the OpenAI client at an alternate endpoint (e.g. a local
    # llama.cpp/Ollama server). Empty = real api.openai.com.
    openai_base_url: str = ""

    cheap_model: str = ""
    strong_model: str = ""
    # Blank = don't send reasoning_effort at all. OpenAI takes low|medium|high;
    # DeepSeek v4 only takes high|max (and some hosts reject the param), so a
    # DeepSeek deployment sets these blank or to high.
    cheap_reasoning_effort: str = "low"
    strong_reasoning_effort: str = "high"

    # How structured output is coerced. "json_schema" + strict is OpenAI-native
    # and the guarantee analysis/report lean on. DeepSeek rejects json_schema,
    # so a DeepSeek deployment sets method="function_calling" and strict=false
    # (DeepSeek has no strict tool schemas); the parse-retry in llm.py covers
    # the weaker guarantee. One of: json_schema | function_calling | json_mode.
    structured_output_method: str = "json_schema"
    structured_output_strict: bool = True

    fetch_timeout_s: float = 120.0  # 2 min per HTTP fetch, comfortably under branch_timeout_s (180s)
    max_job_text_chars: int = 40_000
    max_fetched_posting_chars: int = 40_000  # cap on url_fetch page text (mirrors max_job_text_chars)
    branch_timeout_s: float = 180.0  # 3 min per fan-out branch, then degrade to unverifiable
    # Per LLM call: bound it so a stalled/slow model can't hang a branch, and
    # don't retry (a hung call would otherwise multiply). Kept comfortably
    # under branch_timeout_s.
    llm_timeout_s: float = 90.0
    # company_research summarizes pages with the cheap model. Cap how many
    # pages and how many run at once so the fan-out never saturates a
    # single-slot local LLM (llama.cpp) into serialized minutes.
    research_max_pages: int = 5
    research_concurrency: int = 3
    total_deadline_s: float = 600.0  # 10 min soft deadline for the whole investigation
    stale_queued_threshold_s: float = 900.0
    # running rows older than this since creation are treated as zombies —
    # comfortably beyond total_deadline_s + dispatch latency so a legit
    # in-flight run is never swept
    zombie_running_threshold_s: float = 1800.0
    # Global emergency brake (spec §4.3): once the day's summed spend across all
    # investigations reaches this, new runs are refused (terminal 'failed' +
    # capacity marker) instead of running. Backstop against account-farm abuse
    # that slips the per-user quota. USD.
    global_daily_usd_ceiling: float = 25.00

settings = Settings()
