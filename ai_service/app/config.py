from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    ai_provider: str = "openai"
    openai_api_key: str = "sk-xxx"
    openai_model: str = "gpt-4o"
    openai_base_url: str = "https://api.openai.com/v1"
    host: str = "0.0.0.0"
    port: int = 8000

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
