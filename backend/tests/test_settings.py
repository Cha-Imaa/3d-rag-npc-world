"""Tests for reading settings. Each test uses its own file, so a real .env is never read."""

from pathlib import Path

import pytest

from app.settings import Settings

SETTING_NAMES = [
    "OPENAI_API_KEY",
    "OPENAI_CHAT_MODEL",
    "OPENAI_REASONING_EFFORT",
    "USE_FAKE_LLM",
]


@pytest.fixture(autouse=True)
def clear_setting_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    """Remove real environment variables, which would otherwise win over the test files."""
    for name in SETTING_NAMES:
        monkeypatch.delenv(name, raising=False)


def write_env_file(folder: Path, text: str) -> Path:
    """Write a temporary .env file and return its path."""
    env_file = folder / ".env"
    env_file.write_text(text, encoding="utf-8")
    return env_file


def test_defaults_apply_without_an_env_file() -> None:
    settings = Settings(_env_file=None)

    assert settings.openai_api_key is None
    assert settings.openai_chat_model == "gpt-6-luna"
    assert settings.openai_reasoning_effort == "none"
    assert settings.use_fake_llm is False


def test_values_are_read_from_the_env_file(tmp_path: Path) -> None:
    env_file = write_env_file(
        tmp_path,
        "OPENAI_API_KEY=test-key\nOPENAI_CHAT_MODEL=test-model\nOPENAI_REASONING_EFFORT=low\n",
    )

    settings = Settings(_env_file=env_file)

    assert settings.openai_api_key.get_secret_value() == "test-key"
    assert settings.openai_chat_model == "test-model"
    assert settings.openai_reasoning_effort == "low"


def test_the_fake_llm_can_be_turned_on(tmp_path: Path) -> None:
    env_file = write_env_file(tmp_path, "USE_FAKE_LLM=true\n")

    settings = Settings(_env_file=env_file)

    assert settings.use_fake_llm is True


def test_environment_variables_win_over_the_env_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env_file = write_env_file(tmp_path, "OPENAI_CHAT_MODEL=from-file\n")
    monkeypatch.setenv("OPENAI_CHAT_MODEL", "from-environment")

    settings = Settings(_env_file=env_file)

    assert settings.openai_chat_model == "from-environment"


def test_blank_values_count_as_not_set(tmp_path: Path) -> None:
    env_file = write_env_file(tmp_path, "OPENAI_API_KEY=\nOPENAI_CHAT_MODEL=\n")

    settings = Settings(_env_file=env_file)

    assert settings.openai_api_key is None
    assert settings.openai_chat_model == "gpt-6-luna"


def test_unrelated_names_in_the_env_file_are_ignored(tmp_path: Path) -> None:
    env_file = write_env_file(tmp_path, "SOME_OTHER_TOOL_SETTING=value\n")

    settings = Settings(_env_file=env_file)

    assert settings.openai_api_key is None


def test_the_key_is_hidden_when_settings_are_printed(tmp_path: Path) -> None:
    env_file = write_env_file(tmp_path, "OPENAI_API_KEY=test-key\n")

    settings = Settings(_env_file=env_file)

    assert "test-key" not in repr(settings)
    assert "test-key" not in str(settings)
