import pytest
from httpx import AsyncClient, ASGITransport
from local_server import app

@pytest.mark.asyncio
async def test_health_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert data["status"] == "ok"

@pytest.mark.asyncio
async def test_chat_completions_requires_auth():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.post("/v1/chat/completions", json={
            "model": "auto",
            "messages": [{"role": "user", "content": "test"}]
        })
    assert response.status_code == 401