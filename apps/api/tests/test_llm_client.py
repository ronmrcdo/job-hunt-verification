from app.llm import cheap_model, strong_model
from app.config import settings


def test_llm_clients_are_bounded():
    # A stalled LLM must fail fast, not hang a branch: every client carries a
    # request timeout under the branch budget and does not retry.
    for m in (cheap_model(), strong_model()):
        assert m.request_timeout == settings.llm_timeout_s
        assert m.max_retries == 0
        assert settings.llm_timeout_s < settings.branch_timeout_s
