from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import get_settings
from app.schemas import ChatRequest, ChatResponse
from app.services.chat_service import chat_service

settings = get_settings()

app = FastAPI(
    title="Production Agent AI Service",
    version="0.1.0",
    description="AI microservice for pilot production base management",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "ai-service"}


@app.get("/config")
async def get_config():
    return {
        "provider": settings.ai_provider,
        "model": settings.openai_model,
    }


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Handle a chat message with AI and tool calling."""
    result = await chat_service.chat(
        message=request.message,
        conversation_id=request.conversation_id,
        user_id=request.user_id,
    )
    return ChatResponse(
        conversation_id=result["conversation_id"],
        content=result["content"],
        tool_calls=result.get("tool_calls"),
        tool_results=result.get("tool_results"),
    )


from fastapi.responses import StreamingResponse
import json


@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    """Handle a streaming chat message."""
    async def event_generator():
        async for chunk in chat_service.chat_stream(
            message=request.message,
            conversation_id=request.conversation_id,
            user_id=request.user_id,
        ):
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
    )
