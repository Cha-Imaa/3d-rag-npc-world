"""Backend settings: read from the environment and the .env file at the repository root."""

from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

# An absolute path, so the file is found whichever folder the server starts from.
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    """Every setting the backend reads. Real environment variables win over the .env file."""

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        # A blank line copied from .env.example counts as not set, so defaults still apply.
        env_ignore_empty=True,
        # .env may hold names this class does not use, and those should not stop the server.
        extra="ignore",
    )

    # Optional so the village and the tests run without a key. Only chat needs one.
    # SecretStr keeps the key out of logs and error messages.
    openai_api_key: SecretStr | None = None
    openai_chat_model: str = "gpt-6-luna"
    openai_reasoning_effort: str = "none"
    # Changing this means rebuilding every search index, because old and new vectors don't mix.
    openai_embedding_model: str = "text-embedding-3-small"

    # Answers chat with FakeLlm instead of OpenAI, so building the chat panel costs no credit.
    use_fake_llm: bool = False
